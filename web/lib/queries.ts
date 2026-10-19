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
  type ChartRow,
  type RawPoll,
} from "./pollAverage";
import { estimateHouseEffects, houseEffectMagnitude, type HouseEffects } from "./houseEffects";
import { projectSeats, seatsByBloc, type SeatProjection, type SurplusAgreement } from "./seats";

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

export type SurplusAgreementRow = {
  parties: SurplusAgreement;
  signedOn: Date | null;
  sourceUrl: string;
  sourceName: string;
};

export type PollSnapshot = {
  parties: PartyRow[];
  points: AveragePoint[];
  chartRows: ChartRow[];
  latest: Map<string, AveragePoint>;
  changes: Map<string, number>;
  projections: SeatProjection[];
  /** The same projection with no surplus agreements, to show what they change. */
  projectionsWithoutAgreements: SeatProjection[];
  agreements: SurplusAgreementRow[];
  blocSeats: { bloc: string; seats: number }[];
  pollCount: number;
  asOf: string | null;
  windowDays: number;
  /** Each firm's distance from the field, largest first, for disclosure. */
  houseEffects: { pollster: string; rms: number }[];
  /** The per-firm, per-party leans the average corrects for. */
  leans: HouseEffects;
  /** Every poll, as the average reads them; the coalition odds need them too. */
  rawPolls: RawPoll[];
  /** True while any displayed poll is demo data. */
  hasSeedData: boolean;
};

export async function getPollSnapshot(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  trendDays = 7,
): Promise<PollSnapshot> {
  const [parties, polls, agreementRows] = await Promise.all([
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.poll.findMany({
      include: { results: true },
      orderBy: { fieldDateEnd: "asc" },
    }),
    prisma.surplusAgreement.findMany({ orderBy: { id: "asc" } }),
  ]);
  const agreements: SurplusAgreementRow[] = agreementRows.map((a) => ({
    parties: [a.partyAId, a.partyBId],
    signedOn: a.signedOn,
    sourceUrl: a.sourceUrl,
    sourceName: a.sourceName,
  }));

  const raw: RawPoll[] = polls.map((poll) => ({
    id: poll.id,
    pollster: poll.pollster,
    fieldDateEnd: poll.fieldDateEnd,
    sampleSize: poll.sampleSize,
    results: poll.results.map((r) => ({ partyId: r.partyId, seats: r.seats })),
  }));

  const partyIds = parties.map((p) => p.id);
  // Estimated over the whole history rather than the chosen window: a firm's
  // lean is a property of the firm, and re-estimating it from two weeks of
  // polls would make it lurch about as the reader changes the window.
  const houseEffects = estimateHouseEffects(raw, partyIds);
  const points = movingAverage(raw, partyIds, { windowDays, houseEffects });
  const latest = latestAverages(points);
  const changes = trend(points, trendDays);

  const seatInputs = partyIds.map((id) => ({ partyId: id, averageSeats: latest.get(id)?.mean ?? 0 }));
  const projections = projectSeats(seatInputs, agreements.map((a) => a.parties));
  const projectionsWithoutAgreements = projectSeats(seatInputs);
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
    projectionsWithoutAgreements,
    agreements,
    blocSeats,
    pollCount: polls.length,
    asOf,
    windowDays,
    houseEffects: houseEffectMagnitude(houseEffects),
    leans: houseEffects,
    rawPolls: raw,
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

export type SeatEdge = {
  partyId: string;
  name: string;
  color: string;
  seats: number;
  /** The candidate at the party's last projected seat. */
  lastIn: { id: string; name: string; listPosition: number } | null;
  /** The next one down the list — in with one more seat. */
  nextUp: { id: string; name: string; listPosition: number } | null;
};

/**
 * For every party the projection gives seats to, who holds its last seat and
 * who is first in line for one more — the people a one-seat swing decides.
 *
 * Only official candidates (provenance "etl") are named; where the list has no
 * one at that place, the slot is null rather than filled in.
 */
export async function getSeatEdges(snapshot: PollSnapshot): Promise<SeatEdge[]> {
  const byId = new Map(snapshot.parties.map((p) => [p.id, p]));
  const seated = snapshot.projections
    .filter((p) => p.seats > 0)
    .sort((a, b) => b.seats - a.seats || b.share - a.share);
  if (seated.length === 0) return [];

  const candidates = await prisma.candidate.findMany({
    where: {
      provenance: "etl",
      OR: seated.map((p) => ({ partyId: p.partyId, listPosition: { in: [p.seats, p.seats + 1] } })),
    },
    select: { id: true, name: true, listPosition: true, partyId: true },
  });
  const at = (partyId: string, position: number) => {
    const c = candidates.find((x) => x.partyId === partyId && x.listPosition === position);
    return c ? { id: c.id, name: c.name, listPosition: c.listPosition } : null;
  };

  return seated.map((p) => ({
    partyId: p.partyId,
    name: byId.get(p.partyId)?.name ?? p.partyId,
    color: byId.get(p.partyId)?.color ?? "#888",
    seats: p.seats,
    lastIn: at(p.partyId, p.seats),
    nextUp: at(p.partyId, p.seats + 1),
  }));
}
