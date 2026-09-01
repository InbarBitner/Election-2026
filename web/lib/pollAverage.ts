/**
 * Poll aggregation — weighted moving average.
 *
 * Only raw polls are stored in the database. The average is computed here, at
 * request time, so the user can change the window without a re-run of the ETL.
 * This is the single implementation of the averaging logic in the project.
 */

export type RawPoll = {
  id: string;
  pollster: string;
  fieldDateEnd: Date;
  sampleSize: number;
  results: { partyId: string; seats: number }[];
};

export type AveragePoint = {
  /** YYYY-MM-DD */
  date: string;
  partyId: string;
  /** Weighted mean of seats over the window. */
  mean: number;
  /** Weighted-standard-deviation band, for the uncertainty ribbon. */
  lo: number;
  hi: number;
  /** How many polls fed this point — surfaced in the tooltip. */
  pollCount: number;
};

export type AverageOptions = {
  /** Length of the rolling window, in days. */
  windowDays?: number;
  /** Age in days at which a poll's weight is halved. */
  halfLifeDays?: number;
};

const DAY_MS = 86_400_000;

export const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_HALF_LIFE_DAYS = 7;

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS) * DAY_MS;
}

/**
 * Keep at most one poll per pollster per day — the most recently published one.
 *
 * Without this a pollster that publishes daily tracking would dominate the
 * average purely by frequency, which is a well-known way to get the aggregate
 * wrong. Note this de-duplicates *within* a day only; a pollster polling on
 * many different days legitimately contributes on each of them.
 */
export function dedupePolls(polls: RawPoll[]): RawPoll[] {
  const byKey = new Map<string, RawPoll>();
  for (const poll of polls) {
    const key = `${poll.pollster}|${toDateKey(poll.fieldDateEnd)}`;
    const existing = byKey.get(key);
    // Ties broken by id so the result is deterministic.
    if (
      !existing ||
      poll.fieldDateEnd.getTime() > existing.fieldDateEnd.getTime() ||
      (poll.fieldDateEnd.getTime() === existing.fieldDateEnd.getTime() &&
        poll.id > existing.id)
    ) {
      byKey.set(key, poll);
    }
  }
  return [...byKey.values()];
}

/**
 * Weight of a single poll at a given as-of date.
 *
 * sqrt(sampleSize) reflects that precision grows with the square root of the
 * sample, and the exponential decay makes a three-week-old poll count for much
 * less than yesterday's without discarding it outright.
 */
export function pollWeight(
  poll: RawPoll,
  asOfMs: number,
  halfLifeDays: number,
): number {
  const ageDays = Math.max(0, (asOfMs - startOfDay(poll.fieldDateEnd)) / DAY_MS);
  const decay = Math.pow(0.5, ageDays / halfLifeDays);
  return Math.sqrt(Math.max(1, poll.sampleSize)) * decay;
}

/**
 * Compute a daily weighted moving average per party.
 *
 * Returns one point per (day, party) for every day from the first poll to the
 * most recent one, so the chart has a continuous line even on days when nobody
 * published. Days whose window contains no poll at all are skipped.
 */
export function movingAverage(
  polls: RawPoll[],
  partyIds: string[],
  options: AverageOptions = {},
): AveragePoint[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  if (polls.length === 0 || partyIds.length === 0) return [];

  const clean = dedupePolls(polls).sort(
    (a, b) => a.fieldDateEnd.getTime() - b.fieldDateEnd.getTime(),
  );

  const firstDay = startOfDay(clean[0].fieldDateEnd);
  const lastDay = startOfDay(clean[clean.length - 1].fieldDateEnd);

  const points: AveragePoint[] = [];
  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const windowStart = day - (windowDays - 1) * DAY_MS;
    const inWindow = clean.filter((p) => {
      const t = startOfDay(p.fieldDateEnd);
      return t >= windowStart && t <= day;
    });
    if (inWindow.length === 0) continue;

    const date = toDateKey(new Date(day));
    for (const partyId of partyIds) {
      let sumW = 0;
      let sumWX = 0;
      let sumWX2 = 0;
      let count = 0;
      for (const poll of inWindow) {
        const result = poll.results.find((r) => r.partyId === partyId);
        // A party missing from a poll means "below reporting threshold", which
        // is information: treat it as 0 seats rather than dropping the poll.
        const seats = result ? result.seats : 0;
        const w = pollWeight(poll, day, halfLifeDays);
        sumW += w;
        sumWX += w * seats;
        sumWX2 += w * seats * seats;
        count += 1;
      }
      if (sumW === 0) continue;
      const mean = sumWX / sumW;
      const variance = Math.max(0, sumWX2 / sumW - mean * mean);
      const sd = Math.sqrt(variance);
      points.push({
        date,
        partyId,
        mean: round1(mean),
        lo: round1(Math.max(0, mean - sd)),
        hi: round1(mean + sd),
        pollCount: count,
      });
    }
  }
  return points;
}

/** The most recent average point per party. */
export function latestAverages(points: AveragePoint[]): Map<string, AveragePoint> {
  const latest = new Map<string, AveragePoint>();
  for (const p of points) {
    const existing = latest.get(p.partyId);
    if (!existing || p.date > existing.date) latest.set(p.partyId, p);
  }
  return latest;
}

/**
 * Change in the average between the latest point and `daysBack` days earlier,
 * used for the trend arrows and for detecting swings in the daily brief.
 */
export function trend(points: AveragePoint[], daysBack = 7): Map<string, number> {
  const latest = latestAverages(points);
  const out = new Map<string, number>();
  for (const [partyId, point] of latest) {
    const target = toDateKey(new Date(new Date(point.date).getTime() - daysBack * DAY_MS));
    const past = points
      .filter((p) => p.partyId === partyId && p.date <= target)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    out.set(partyId, past ? round1(point.mean - past.mean) : 0);
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Reshape points into one row per date with a column per party, for Recharts. */
export function toChartRows(
  points: AveragePoint[],
): Record<string, string | number>[] {
  const byDate = new Map<string, Record<string, string | number>>();
  for (const p of points) {
    let row = byDate.get(p.date);
    if (!row) {
      row = { date: p.date };
      byDate.set(p.date, row);
    }
    row[p.partyId] = p.mean;
  }
  return [...byDate.values()].sort((a, b) =>
    String(a.date) < String(b.date) ? -1 : 1,
  );
}
