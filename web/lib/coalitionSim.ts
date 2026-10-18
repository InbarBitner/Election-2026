/**
 * Monte Carlo over the seat projection: how likely is a set of parties to
 * reach a majority, given how uncertain the polls are?
 *
 * The method was worked out in research/09_coalition_montecarlo.ipynb. Each
 * simulated election draws every party's seats around its poll average and
 * runs the result through the real allocation (threshold + Bader-Ofer, from
 * seats.ts); a coalition's chance is the share of draws in which it holds 61.
 *
 * Three modelling choices, each stated rather than hidden:
 *
 * 1. Spread. A party's uncertainty is the standard deviation of the recent
 *    polls around its average, measured after each firm's house effect is
 *    removed. Measured on raw polls it would count a firm's steady lean as
 *    randomness: Channel 14's habit of giving the Likud more seats made the
 *    Likud look twice as uncertain as it is.
 * 2. Floor. No party is treated as more certain than ±SD_FLOOR seats. A party
 *    every firm puts at exactly 8 is not known to the seat, and with a dozen
 *    polls the measured spread of a small party is mostly luck. For parties
 *    near the threshold the floor largely decides their chance of passing it.
 * 3. Correlation. Polling misses tend to move a whole camp together — a
 *    turnout surprise lifts every party that draws on it. Each party's
 *    deviation is part shared with its bloc and part its own, with correlation
 *    BLOC_CORRELATION inside a bloc and none across. Independent draws would
 *    let one party's surprise cancel another's and understate how often a
 *    bloc reaches a majority. 0.5 is an assumption, not an estimate: a dozen
 *    polls cannot measure it.
 */

import { houseEffectOf, type HouseEffects } from "./houseEffects.ts";
import { dedupePolls, seatsOf, startOfDayMs, type RawPoll } from "./pollAverage.ts";
import { projectSeats } from "./seats.ts";
import { MAJORITY } from "./coalitions.ts";

export const SD_FLOOR = 1;
export const BLOC_CORRELATION = 0.5;
export const SIMULATIONS = 10_000;
export const SPREAD_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

export type SimParty = { id: string; bloc: string; mean: number; sd: number };

/**
 * Each party's spread: the standard deviation of its house-effect-corrected
 * seats across the polls in the window, around its current average, floored.
 * A party missing from a poll counts as 0 there, as in the average.
 */
export function partySpread(
  polls: RawPoll[],
  means: Map<string, number>,
  options: {
    asOf: Date;
    houseEffects?: HouseEffects;
    windowDays?: number;
    floor?: number;
  },
): Map<string, number> {
  const floor = options.floor ?? SD_FLOOR;
  const end = startOfDayMs(options.asOf);
  const start = end - ((options.windowDays ?? SPREAD_WINDOW_DAYS) - 1) * DAY_MS;
  const recent = dedupePolls(polls).filter((p) => {
    const t = startOfDayMs(p.fieldDateEnd);
    return t >= start && t <= end;
  });

  const spread = new Map<string, number>();
  for (const [partyId, mean] of means) {
    let sumSq = 0;
    for (const poll of recent) {
      const lean = houseEffectOf(options.houseEffects, poll.pollster, partyId);
      const seats = Math.max(0, (seatsOf(poll, partyId) ?? 0) - lean);
      sumSq += (seats - mean) ** 2;
    }
    const sd = recent.length > 1 ? Math.sqrt(sumSq / (recent.length - 1)) : 0;
    spread.set(partyId, Math.max(floor, sd));
  }
  return spread;
}

/** A small seeded generator, so the page shows the same odds on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSampler(random: () => number): () => number {
  return () => {
    // Box-Muller; 1 - u keeps the log away from 0.
    const u = 1 - random();
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/**
 * `n` simulated elections, as a row-major n × parties.length matrix of whole
 * seats in the order of `parties`. Every row sums to 120.
 */
export function simulate(
  parties: SimParty[],
  options: { n?: number; correlation?: number; seed?: number } = {},
): Uint8Array {
  const n = options.n ?? SIMULATIONS;
  const rho = options.correlation ?? BLOC_CORRELATION;
  const normal = normalSampler(mulberry32(options.seed ?? 2026));
  const shared = Math.sqrt(rho);
  const own = Math.sqrt(1 - rho);
  const blocs = [...new Set(parties.map((p) => p.bloc))];

  const k = parties.length;
  const out = new Uint8Array(n * k);
  for (let row = 0; row < n; row++) {
    const blocShift = new Map(blocs.map((b) => [b, normal()]));
    const inputs = parties.map((p) => ({
      partyId: p.id,
      averageSeats: Math.max(
        0,
        p.mean + p.sd * (shared * blocShift.get(p.bloc)! + own * normal()),
      ),
    }));
    projectSeats(inputs).forEach((projection, i) => {
      out[row * k + i] = projection.seats;
    });
  }
  return out;
}

/** Share of simulated elections in which the given columns hold a majority. */
export function majorityProbability(
  draws: Uint8Array,
  partyCount: number,
  members: number[],
  majority: number = MAJORITY,
): number {
  const rows = draws.length / partyCount;
  if (rows === 0) return 0;
  let wins = 0;
  for (let row = 0; row < rows; row++) {
    let total = 0;
    for (const i of members) total += draws[row * partyCount + i];
    if (total >= majority) wins++;
  }
  return wins / rows;
}

/** For each party, the share of simulated elections in which it won seats. */
export function thresholdProbability(draws: Uint8Array, partyCount: number): number[] {
  const rows = draws.length / partyCount;
  const passed = new Array<number>(partyCount).fill(0);
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < partyCount; i++) if (draws[row * partyCount + i] > 0) passed[i]++;
  }
  return passed.map((count) => (rows === 0 ? 0 : count / rows));
}
