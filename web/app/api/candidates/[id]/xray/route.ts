import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * The candidate "X-ray": a short overview, the voting record and bills.
 *
 * Loaded on demand rather than with the party page, because a list page shows
 * dozens of candidates and almost none of them get opened.
 */
/** Milliseconds for ordering only: the date, else 1 January of the title's year. */
function billRecency(bill: { date: Date | null; year: number | null; knessetNum: number | null }): number {
  if (bill.date) return bill.date.getTime();
  if (bill.year) return Date.UTC(bill.year, 0, 1);
  return bill.knessetNum ?? 0;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id },
    include: {
      party: true,
      votes: { orderBy: { date: "desc" }, take: 60 },
      // Ordered below, not here: see `billRecency`.
      bills: true,
    },
  });

  if (!candidate) {
    return NextResponse.json({ error: "מועמד לא נמצא" }, { status: 404 });
  }

  // The Knesset records a publication date only for bills that became law;
  // proposals have just the Knesset and the year in their title. Sorting on
  // the date column alone would therefore put every law, however old, above
  // every proposal, however new. So the order uses the date where there is
  // one and the year otherwise.
  const bills = [...candidate.bills]
    .sort((a, b) => billRecency(b) - billRecency(a) || b.id.localeCompare(a.id))
    .slice(0, 30);

  const votes = candidate.votes;
  const cast = votes.filter((v) => v.position !== "absent");
  const attendance = votes.length === 0 ? null : cast.length / votes.length;
  const factionBreaks = cast.filter((v) => v.againstFaction).length;

  // Votes grouped by topic, so the reader sees a pattern rather than a list.
  const byTopic = new Map<string, { for: number; against: number; abstain: number; absent: number }>();
  for (const vote of votes) {
    const entry = byTopic.get(vote.topic) ?? { for: 0, against: 0, abstain: 0, absent: 0 };
    entry[vote.position as keyof typeof entry] += 1;
    byTopic.set(vote.topic, entry);
  }

  return NextResponse.json({
    candidate: {
      id: candidate.id,
      name: candidate.name,
      bio: candidate.bio,
      overview: candidate.overview,
      overviewSourceUrl: candidate.overviewSourceUrl,
      listPosition: candidate.listPosition,
      provenance: candidate.provenance,
      sourceUrl: candidate.sourceUrl,
      sourceName: candidate.sourceName,
      party: {
        name: candidate.party.name,
        slug: candidate.party.slug,
        color: candidate.party.color,
      },
    },
    summary: {
      voteCount: votes.length,
      attendance,
      factionBreaks,
      billCount: candidate.bills.length,
      leadSponsorCount: candidate.bills.filter((b) => b.isLeadSponsor).length,
      byTopic: [...byTopic.entries()].map(([topic, counts]) => ({ topic, ...counts })),
    },
    votes: candidate.votes,
    bills,
  });
}
