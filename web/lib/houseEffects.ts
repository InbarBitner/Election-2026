/**
 * House effects — the systematic lean of each polling firm.
 *
 * Two firms polling the same electorate on the same day do not get the same
 * answer, and the gap between them is not random: it comes from panel
 * composition, turnout screens, how the question is worded, and how undecideds
 * are pushed. Averaging raw polls therefore does not average the bias away — it
 * inherits whatever the most prolific firms lean towards.
 *
 * What can and cannot be measured matters here. There is no way to know which
 * firm is *right*; the election is the only measurement of that, and it has not
 * happened. All that is measurable is how each firm sits relative to the rest.
 * So the field as a whole is defined as unbiased and every effect is expressed
 * relative to it — see `doubleCentre`. Correcting house effects makes the
 * pollsters agree with each other; it does not make them right.
 */

// The extension is required, not stylistic: scripts/ runs these modules under
// bare `node`, whose TypeScript support resolves specifiers literally and will
// not try `.ts` for an extensionless path. Vitest and Next both resolve it
// either way, so leaving it off failed only outside the test suite.
import { dedupePolls, seatsOf, startOfDayMs, type RawPoll } from "./pollAverage.ts";

/** pollster -> partyId -> seats to subtract from that firm's figures. */
export type HouseEffects = Map<string, Map<string, number>>;

export type HouseEffectOptions = {
  /**
   * Half-width, in days, of the centred window used to build the reference
   * consensus a poll is compared against.
   */
  referenceWindowDays?: number;
  /**
   * How many polls of evidence a firm needs before its estimated lean is taken
   * at face value. See `shrink`.
   */
  shrinkage?: number;
};

const DAY_MS = 86_400_000;
export const DEFAULT_REFERENCE_WINDOW_DAYS = 10;
export const DEFAULT_SHRINKAGE = 5;

/**
 * Pull an estimate towards zero in proportion to how little evidence backs it.
 *
 * A firm with one poll differing from the consensus by 3 seats is far more
 * likely to have caught a real shift, or noise, than to have a 3-seat lean.
 * Without this, a single outlying poll becomes a permanent correction applied
 * to that firm forever. With shrinkage 5: one poll keeps 1/6 of its apparent
 * lean, five polls keep half, forty polls keep 89%.
 */
export function shrink(estimate: number, pollCount: number, shrinkage: number): number {
  if (pollCount <= 0) return 0;
  return estimate * (pollCount / (pollCount + shrinkage));
}

/**
 * Remove the row and column means from a matrix, so both sum to zero.
 *
 * Two invariants have to hold at once, and this is the standard way to get
 * both:
 *
 * - **Every party's effects sum to zero across firms.** The consensus is the
 *   anchor. Without this the correction could shift every firm the same way and
 *   silently move the whole average, which is inventing a result rather than
 *   removing a bias.
 * - **Every firm's effects sum to zero across parties.** A poll's seats sum to
 *   120, so its corrections must sum to 0 or the corrected poll no longer adds
 *   up — and the seat projection would be handed a total it cannot interpret.
 */
export function doubleCentre(matrix: Map<string, Map<string, number>>): void {
  const rows = [...matrix.keys()];
  const columns = new Set<string>();
  for (const row of matrix.values()) for (const key of row.keys()) columns.add(key);
  if (rows.length === 0 || columns.size === 0) return;

  const at = (row: string, column: string) => matrix.get(row)?.get(column) ?? 0;

  const rowMean = new Map<string, number>();
  for (const row of rows) {
    let sum = 0;
    for (const column of columns) sum += at(row, column);
    rowMean.set(row, sum / columns.size);
  }
  const columnMean = new Map<string, number>();
  for (const column of columns) {
    let sum = 0;
    for (const row of rows) sum += at(row, column);
    columnMean.set(column, sum / rows.length);
  }
  let grand = 0;
  for (const row of rows) grand += rowMean.get(row)!;
  grand /= rows.length;

  for (const row of rows) {
    const target = matrix.get(row) ?? new Map<string, number>();
    matrix.set(row, target);
    for (const column of columns) {
      target.set(column, at(row, column) - rowMean.get(row)! - columnMean.get(column)! + grand);
    }
  }
}

/**
 * Estimate each firm's lean, in seats, per party.
 *
 * A poll is compared against a consensus built from *other firms* polling
 * around the same date. Leaving the firm out of its own reference is not a
 * refinement: a firm publishing a third of the polls in a window would
 * otherwise be measured largely against itself, and its lean would come out
 * near zero however far from the field it actually sits.
 *
 * The reference window is centred rather than trailing, because this is a
 * measurement of the past and the polls on both sides are already known.
 */
export function estimateHouseEffects(
  polls: RawPoll[],
  partyIds: string[],
  options: HouseEffectOptions = {},
): HouseEffects {
  const halfWidth = options.referenceWindowDays ?? DEFAULT_REFERENCE_WINDOW_DAYS;
  const shrinkage = options.shrinkage ?? DEFAULT_SHRINKAGE;
  const effects: HouseEffects = new Map();
  if (polls.length === 0 || partyIds.length === 0) return effects;

  const clean = dedupePolls(polls);

  // Sum of residuals and their count, per firm and party.
  const total = new Map<string, Map<string, number>>();
  const seen = new Map<string, Map<string, number>>();
  const pollsPerFirm = new Map<string, number>();

  for (const poll of clean) {
    const day = startOfDayMs(poll.fieldDateEnd);
    const reference = clean.filter(
      (other) =>
        other.pollster !== poll.pollster &&
        Math.abs(startOfDayMs(other.fieldDateEnd) - day) <= halfWidth * DAY_MS,
    );
    if (reference.length === 0) continue;
    pollsPerFirm.set(poll.pollster, (pollsPerFirm.get(poll.pollster) ?? 0) + 1);

    for (const partyId of partyIds) {
      const mine = seatsOf(poll, partyId);
      if (mine === undefined) continue;

      // Firms that did not list the party at all are silent about it rather
      // than reporting zero, so they must not drag the reference down.
      const theirs = reference
        .map((other) => seatsOf(other, partyId))
        .filter((seats): seats is number => seats !== undefined);
      if (theirs.length === 0) continue;

      const consensus = theirs.reduce((sum, seats) => sum + seats, 0) / theirs.length;

      // Leaving a firm out of its own benchmark is necessary, but it overstates
      // the gap and the overstatement has to be undone. Leans sum to zero
      // across k firms, so the others average to -b/(k-1) when this firm's true
      // lean is b, and the observed residual is b·k/(k-1) rather than b. In a
      // three-firm field that is 50% too large; the fix scales it back by
      // (k-1)/k. Without it every published figure moves further than the
      // evidence supports, which is the same failure as not correcting at all,
      // pointed the other way.
      const others = new Set(reference.map((other) => other.pollster)).size;
      const deflate = others / (others + 1);

      const byParty = total.get(poll.pollster) ?? new Map<string, number>();
      total.set(poll.pollster, byParty);
      byParty.set(partyId, (byParty.get(partyId) ?? 0) + (mine - consensus) * deflate);

      const counts = seen.get(poll.pollster) ?? new Map<string, number>();
      seen.set(poll.pollster, counts);
      counts.set(partyId, (counts.get(partyId) ?? 0) + 1);
    }
  }

  for (const [pollster, byParty] of total) {
    const row = new Map<string, number>();
    for (const [partyId, sum] of byParty) {
      const count = seen.get(pollster)?.get(partyId) ?? 0;
      if (count === 0) continue;
      row.set(partyId, shrink(sum / count, pollsPerFirm.get(pollster) ?? 0, shrinkage));
    }
    effects.set(pollster, row);
  }

  doubleCentre(effects);
  return effects;
}

/** The lean to subtract, or 0 when the firm or party has no estimate. */
export function houseEffectOf(
  effects: HouseEffects | undefined,
  pollster: string,
  partyId: string,
): number {
  return effects?.get(pollster)?.get(partyId) ?? 0;
}

/** How far each firm sits from the field overall, for reporting. */
export function houseEffectMagnitude(effects: HouseEffects): { pollster: string; rms: number }[] {
  const out: { pollster: string; rms: number }[] = [];
  for (const [pollster, row] of effects) {
    let sum = 0;
    let n = 0;
    for (const value of row.values()) {
      sum += value * value;
      n += 1;
    }
    out.push({ pollster, rms: n ? Math.sqrt(sum / n) : 0 });
  }
  return out.sort((a, b) => b.rms - a.rms);
}
