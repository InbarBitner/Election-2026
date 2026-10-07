/**
 * Report the measured lean of each polling firm.
 *
 * A diagnostic rather than part of the site: the correction runs automatically
 * inside `getPollSnapshot`, and this prints what it found so the numbers can be
 * argued with. An estimate nobody can inspect is an estimate nobody should
 * trust — least of all one that quietly moves published figures.
 *
 * Usage:
 *   node scripts/house-effects.ts                # read the local database
 *   node scripts/house-effects.ts --stdin        # read polls as JSON on stdin
 *   node scripts/house-effects.ts --json         # machine-readable output
 *
 * The --stdin form takes [{id, pollster, fieldDateEnd, sampleSize,
 * results:[{partyId, seats}]}], so the CI probe can feed it polls parsed
 * straight off the live page without a database.
 */

import {
  DEFAULT_REFERENCE_WINDOW_DAYS,
  DEFAULT_SHRINKAGE,
  estimateHouseEffects,
} from "../lib/houseEffects.ts";
import { dedupePolls, type RawPoll } from "../lib/pollAverage.ts";

type Named = { id: string; name: string };

/**
 * Load Prisma only when the database is actually being read.
 *
 * `--stdin` needs no database, and the CI probe runs it that way against polls
 * parsed straight off the live page. A top-level import made that impossible:
 * the generated client does not exist until `prisma generate` has run, and
 * under bare node it resolves as CommonJS whose named exports may not survive
 * — so the probe died on an import it never needed.
 */
async function openPrisma() {
  let mod: Record<string, unknown>;
  try {
    mod = await import("@prisma/client");
  } catch {
    // Not installed at all, rather than installed but ungenerated. Both mean
    // the same thing to whoever ran this, so they get the same instruction.
    mod = {};
  }
  const holder = (mod.PrismaClient ? mod : (mod.default as Record<string, unknown>)) ?? {};
  const Client = holder.PrismaClient as (new () => {
    party: { findMany(args: unknown): Promise<{ id: string; name: string }[]> };
    poll: { findMany(args: unknown): Promise<PollRow[]> };
    $disconnect(): Promise<void>;
  }) | undefined;
  if (!Client) {
    throw new Error(
      "לא נמצא לקוח Prisma. יש להריץ `npm run db:generate` לפני קריאה מהמסד, " +
        "או להשתמש ב---stdin.",
    );
  }
  return new Client();
}

type PollRow = {
  id: string;
  pollster: string;
  fieldDateEnd: Date;
  sampleSize: number;
  results: { partyId: string; seats: number }[];
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function load(): Promise<{ polls: RawPoll[]; parties: Named[] }> {
  if (process.argv.includes("--stdin")) {
    const parsed = JSON.parse(await readStdin()) as {
      id: string;
      pollster: string;
      fieldDateEnd: string;
      sampleSize: number;
      results: { partyId: string; seats: number }[];
    }[];
    const polls = parsed.map((p) => ({ ...p, fieldDateEnd: new Date(p.fieldDateEnd) }));
    const ids = new Set<string>();
    for (const poll of polls) for (const r of poll.results) ids.add(r.partyId);
    return { polls, parties: [...ids].sort().map((id) => ({ id, name: id })) };
  }

  const prisma = await openPrisma();
  try {
    const [parties, polls] = await Promise.all([
      prisma.party.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.poll.findMany({ include: { results: true }, orderBy: { fieldDateEnd: "asc" } }),
    ]);
    return {
      parties: parties.map((p) => ({ id: p.id, name: p.name })),
      polls: polls.map((poll) => ({
        id: poll.id,
        pollster: poll.pollster,
        fieldDateEnd: poll.fieldDateEnd,
        sampleSize: poll.sampleSize,
        results: poll.results.map((r) => ({ partyId: r.partyId, seats: r.seats })),
      })),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const { polls, parties } = await load();
  const partyIds = parties.map((p) => p.id);
  const nameOf = new Map(parties.map((p) => [p.id, p.name]));
  const effects = estimateHouseEffects(polls, partyIds);

  const pollsPerFirm = new Map<string, number>();
  for (const poll of dedupePolls(polls)) {
    pollsPerFirm.set(poll.pollster, (pollsPerFirm.get(poll.pollster) ?? 0) + 1);
  }

  const rows = [...effects]
    .map(([pollster, row]) => {
      const values = [...row.values()];
      const rms = values.length
        ? Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length)
        : 0;
      const leans = [...row]
        .filter(([, v]) => Math.abs(v) >= 0.3)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      return { pollster, polls: pollsPerFirm.get(pollster) ?? 0, rms, leans };
    })
    .sort((a, b) => b.rms - a.rms);

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        rows.map((r) => ({
          pollster: r.pollster,
          polls: r.polls,
          rms: Number(r.rms.toFixed(3)),
          leans: Object.fromEntries(r.leans.map(([id, v]) => [id, Number(v.toFixed(2))])),
        })),
      ),
    );
    return;
  }

  console.log(
    `\nהטיית בתי הסקרים · ${dedupePolls(polls).length} סקרים · ` +
      `חלון ייחוס ±${DEFAULT_REFERENCE_WINDOW_DAYS} ימים · כיווץ ${DEFAULT_SHRINKAGE}\n`,
  );
  console.log("כל ערך הוא מנדטים מעל או מתחת לשאר בתי הסקרים, אחרי כיווץ.\n");

  for (const row of rows) {
    const summary = row.leans
      .slice(0, 5)
      .map(([id, v]) => `${nameOf.get(id) ?? id} ${v > 0 ? "+" : ""}${v.toFixed(1)}`)
      .join(" · ");
    console.log(
      `  ${row.pollster.padEnd(24)} ${row.polls.toString().padStart(3)} סקרים  ` +
        `סטייה ${row.rms.toFixed(2)}  ${summary || "אין הטיה מובהקת"}`,
    );
  }
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
