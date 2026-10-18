/**
 * Poll statistics as JSON, for consumers outside the web app.
 *
 * The daily brief needs the same moving average and seat projection the site
 * shows. Rather than re-implementing the maths in Python and letting the two
 * drift apart, the Python side shells out to this script, so lib/pollAverage.ts
 * and lib/seats.ts stay the only implementations in the project.
 *
 * Usage: node scripts/poll-stats.ts [--window 14] [--trend-days 7]
 * Output: a single JSON object on stdout.
 */

import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_WINDOW_DAYS,
  latestAverages,
  movingAverage,
  trend,
  type RawPoll,
} from "../lib/pollAverage.ts";
import { estimateHouseEffects } from "../lib/houseEffects.ts";
import { projectSeats, seatsByBloc } from "../lib/seats.ts";

function numericArg(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  const windowDays = numericArg("--window", DEFAULT_WINDOW_DAYS);
  const trendDays = numericArg("--trend-days", 7);

  const prisma = new PrismaClient();
  try {
    const parties = await prisma.party.findMany({ where: { isActive: true } });
    const polls = await prisma.poll.findMany({
      include: { results: true },
      orderBy: { fieldDateEnd: "asc" },
    });

    const raw: RawPoll[] = polls.map((poll) => ({
      id: poll.id,
      pollster: poll.pollster,
      fieldDateEnd: poll.fieldDateEnd,
      sampleSize: poll.sampleSize,
      results: poll.results.map((r) => ({ partyId: r.partyId, seats: r.seats })),
    }));

    const partyIds = parties.map((p) => p.id);
    // Same correction the site applies, for the same reason it exists here at
    // all: the brief must not report a swing the chart does not show.
    const houseEffects = estimateHouseEffects(raw, partyIds);
    const points = movingAverage(raw, partyIds, { windowDays, houseEffects });
    const latest = latestAverages(points);
    const movement = trend(points, trendDays);

    // Same surplus agreements the site applies, so the brief's seat counts
    // match the polls page.
    const agreements = await prisma.surplusAgreement.findMany();
    const projections = projectSeats(
      partyIds.map((id) => ({ partyId: id, averageSeats: latest.get(id)?.mean ?? 0 })),
      agreements.map((a): [string, string] => [a.partyAId, a.partyBId]),
    );
    const blocOf = new Map(parties.map((p) => [p.id, p.bloc]));
    const blocs = seatsByBloc(projections, blocOf);

    const asOf = [...latest.values()].reduce(
      (max, p) => (p.date > max ? p.date : max),
      "",
    );

    console.log(
      JSON.stringify({
        asOf,
        windowDays,
        trendDays,
        pollCount: polls.length,
        parties: parties.map((party) => {
          const projection = projections.find((p) => p.partyId === party.id);
          return {
            id: party.id,
            name: party.name,
            bloc: party.bloc,
            average: latest.get(party.id)?.mean ?? 0,
            projectedSeats: projection?.seats ?? 0,
            passedThreshold: projection?.passedThreshold ?? false,
            change: movement.get(party.id) ?? 0,
          };
        }),
        blocs: Object.fromEntries(blocs),
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
