/**
 * Coalition arithmetic on top of the seat projection.
 *
 * Pure counting: which combinations of parties reach a Knesset majority on the
 * current projection. Nothing here judges whether two parties would actually
 * sit together. On the page the reader puts parties in or rules them out, and
 * this module only works out what the remaining parties can add.
 */

import { TOTAL_SEATS } from "./seats";

export const MAJORITY = Math.floor(TOTAL_SEATS / 2) + 1;

export type SeatsById = Record<string, number>;

export type Coalition = { members: string[]; seats: number };

export function coalitionSeats(seats: SeatsById, members: Iterable<string>): number {
  let total = 0;
  for (const id of members) total += seats[id] ?? 0;
  return total;
}

/**
 * The minimal ways to bring `included` to a majority using parties that are
 * neither included nor excluded.
 *
 * "Minimal" means every added party is needed: drop any one of them and the
 * majority is lost. Bigger additions are these plus passengers. With nothing
 * included this is the list of minimal winning coalitions.
 *
 * Only parties with seats can be added. With at most a dozen of them that is a
 * few thousand subsets, so they are simply enumerated. Sorted by the fewest
 * added parties, then the slimmest majority.
 *
 * Returns [] when `included` already has a majority, and also when no
 * addition reaches one; `coalitionSeats` tells the two apart.
 */
export function completions(
  seats: SeatsById,
  included: Iterable<string> = [],
  excluded: Iterable<string> = [],
  majority: number = MAJORITY,
): Coalition[] {
  const inSet = new Set(included);
  const outSet = new Set(excluded);
  const base = coalitionSeats(seats, inSet);
  if (base >= majority) return [];

  const open = Object.keys(seats)
    .filter((id) => seats[id] > 0 && !inSet.has(id) && !outSet.has(id))
    .sort((a, b) => seats[b] - seats[a] || (a < b ? -1 : 1));
  if (open.length > 20) throw new Error(`יותר מדי מפלגות לספירה מלאה: ${open.length}`);

  const found: Coalition[] = [];
  for (let mask = 1; mask < 1 << open.length; mask++) {
    let total = base;
    let smallest = Infinity;
    const added: string[] = [];
    for (let i = 0; i < open.length; i++) {
      if (mask & (1 << i)) {
        added.push(open[i]);
        total += seats[open[i]];
        smallest = Math.min(smallest, seats[open[i]]);
      }
    }
    // Minimal iff dropping even the smallest added party loses the majority.
    if (total >= majority && total - smallest < majority) found.push({ members: added, seats: total });
  }

  return found.sort(
    (a, b) =>
      a.members.length - b.members.length ||
      a.seats - b.seats ||
      a.members.join().localeCompare(b.members.join()),
  );
}
