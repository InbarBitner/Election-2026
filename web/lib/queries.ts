/**
 * Shared data access.
 *
 * Every page that needs the aggregate goes through `getPollSnapshot`, so the
 * dashboard, the polls page and the party pages can never show three different
 * averages for the same day.
 */

import { prisma } from "./db";
import {
  DEFAULT_WINDOW_DAYS,
  latestAverages,
  movingAverage,
  toChartRows,
  trend,
  type AveragePoint,
  type RawPoll,
} from "./pollAverage";
import { projectSeats, seatsByBloc, type SeatProjection } from "./seats";

export type PartyRow = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  leader: string;
  bloc: string;
  color: string;
  colorDark: string;
  provenance: string;
  sourceUrl: string;
  sourceName: string;
};

export type PollSnapshot = {
  parties: PartyRow[];
  points: AveragePoint[];
  chartRows: Record<string, string | number>[];
  latest: Map<string, AveragePoint>;
  changes: Map<string, number>;
  projections: SeatProjection[];
  blocSeats: { bloc: string; seats: number }[];
  pollCount: number;
  asOf: string | null;
  windowDays: number;
  /** True while any displayed poll is demo data. */
  hasSeedData: boolean;
};

export async function getPollSnapshot(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  trendDays = 7,
): Promise<PollSnapshot> {
  const [parties, polls] = await Promise.all([
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.poll.findMany({
      include: { results: true },
      orderBy: { fieldDateEnd: "asc" },
    }),
  ]);

  const raw: RawPoll[] = polls.map((poll) => ({
    id: poll.id,
    pollster: poll.pollster,
    fieldDateEnd: poll.fieldDateEnd,
    sampleSize: poll.sampleSize,
    results: poll.results.map((r) => ({ partyId: r.partyId, seats: r.seats })),
  }));

  const partyIds = parties.map((p) => p.id);
  const points = movingAverage(raw, partyIds, { windowDays });
  const latest = latestAverages(points);
  const changes = trend(points, trendDays);

  const projections = projectSeats(
    partyIds.map((id) => ({ partyId: id, averageSeats: latest.get(id)?.mean ?? 0 })),
  );
  const blocOf = new Map(parties.map((p) => [p.id, p.bloc]));
  const blocSeats = [...seatsByBloc(projections, blocOf).entries()]
    .map(([bloc, seats]) => ({ bloc, seats }))
    .sort((a, b) => b.seats - a.seats);

  const asOf = [...latest.values()].reduce<string | null>(
    (max, p) => (max === null || p.date > max ? p.date : max),
    null,
  );

  return {
    parties,
    points,
    chartRows: toChartRows(points),
    latest,
    changes,
    projections,
    blocSeats,
    pollCount: polls.length,
    asOf,
    windowDays,
    hasSeedData: polls.some((p) => p.provenance === "seed"),
  };
}

/** Parties ordered by their current average — the default order everywhere. */
export function rankedParties(snapshot: PollSnapshot): PartyRow[] {
  return [...snapshot.parties].sort(
    (a, b) =>
      (snapshot.latest.get(b.id)?.mean ?? 0) - (snapshot.latest.get(a.id)?.mean ?? 0) ||
      a.name.localeCompare(b.name, "he"),
  );
}

export async function getPartyBySlug(slug: string) {
  return prisma.party.findUnique({
    where: { slug },
    include: {
      candidates: { orderBy: { listPosition: "asc" } },
      platform: { orderBy: { axis: "asc" } },
    },
  });
}

export async function getRecentPolls(limit = 30) {
  return prisma.poll.findMany({
    include: { results: true },
    orderBy: { fieldDateEnd: "desc" },
    take: limit,
  });
}

export async function getLatestBrief() {
  return prisma.dailyBrief.findFirst({ orderBy: { date: "desc" } });
}

export async function getQuizQuestions() {
  return prisma.quizQuestion.findMany({ orderBy: { order: "asc" } });
}
