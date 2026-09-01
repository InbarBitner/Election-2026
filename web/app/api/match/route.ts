import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { matchBlocs, matchParties, type QuizAnswer, type Vector } from "@/lib/cosine";
import { getPollSnapshot } from "@/lib/queries";

type RequestBody = {
  /** questionId -> { value: 1..5, important: boolean } */
  answers?: Record<string, { value: number; important?: boolean }>;
};

/**
 * Score a completed questionnaire against every party's position vector.
 *
 * Nothing is stored: the answers arrive, are scored, and the response goes
 * back. There is no user record, no cookie and no analytics on this route —
 * a person's political opinions are not ours to keep.
 */
export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "גוף הבקשה אינו JSON תקין" }, { status: 400 });
  }

  const submitted = body.answers ?? {};
  if (Object.keys(submitted).length === 0) {
    return NextResponse.json({ error: "לא התקבלו תשובות" }, { status: 400 });
  }

  const [questions, vectors, snapshot] = await Promise.all([
    prisma.quizQuestion.findMany(),
    prisma.partyVector.findMany({ include: { party: true } }),
    getPollSnapshot(),
  ]);

  const answers: QuizAnswer[] = [];
  for (const question of questions) {
    const given = submitted[question.id];
    if (!given) continue; // Skipped questions simply do not contribute.
    const value = Number(given.value);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      return NextResponse.json(
        { error: `ערך לא תקין לשאלה ${question.id}` },
        { status: 400 },
      );
    }
    answers.push({
      questionId: question.id,
      axis: question.axis,
      value,
      polarity: question.polarity,
      important: Boolean(given.important),
      weight: question.weight,
      shortLabel: question.shortLabel,
    });
  }

  if (answers.length === 0) {
    return NextResponse.json({ error: "לא התקבלו תשובות תקינות" }, { status: 400 });
  }

  const partyVectors = vectors
    .filter((row) => row.party.isActive)
    .map((row) => ({
      partyId: row.partyId,
      vector: JSON.parse(row.vectorJson) as Vector,
    }));

  if (partyVectors.length === 0) {
    return NextResponse.json(
      { error: "טרם נבנו וקטורי מפלגות. הרץ python -m pipeline.ml.build_vectors" },
      { status: 503 },
    );
  }

  const matches = matchParties(answers, partyVectors);

  const partyById = new Map(vectors.map((row) => [row.partyId, row.party]));
  const blocOf = new Map(vectors.map((row) => [row.partyId, row.party.bloc]));
  const seatsOf = new Map(
    snapshot.projections.map((projection) => [projection.partyId, projection.seats]),
  );

  return NextResponse.json({
    answered: answers.length,
    totalQuestions: questions.length,
    parties: matches.map((match) => {
      const party = partyById.get(match.partyId);
      return {
        id: match.partyId,
        name: party?.name ?? match.partyId,
        slug: party?.slug ?? "",
        color: party?.color ?? "#888",
        colorDark: party?.colorDark ?? "#888",
        bloc: party?.bloc ?? "",
        score: match.score,
        projectedSeats: seatsOf.get(match.partyId) ?? 0,
        agreements: match.agreements,
        disagreements: match.disagreements,
      };
    }),
    blocs: matchBlocs(matches, blocOf, seatsOf),
  });
}
