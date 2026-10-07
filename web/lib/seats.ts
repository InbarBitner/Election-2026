/**
 * Seat projection — electoral threshold + the Bader-Ofer allocation method.
 *
 * Israeli pollsters publish results in seats rather than vote shares, so the
 * averaged seat numbers are first converted back to an implied vote share, the
 * 3.25% threshold is applied to that share, and the 120 seats are then
 * reallocated among the parties that cleared it. This is why a party polling
 * just under the threshold "gives" its seats to the others.
 */

export const TOTAL_SEATS = 120;
export const THRESHOLD = 0.0325;

export type SeatInput = { partyId: string; averageSeats: number };

/** Two parties that agreed to pool their remainder votes ("הסכם עודפים"). */
export type SurplusAgreement = [string, string];

export type SeatProjection = {
  partyId: string;
  seats: number;
  /** Implied vote share, 0..1. */
  share: number;
  passedThreshold: boolean;
  /** Share minus the threshold — negative means "how far below". */
  distanceFromThreshold: number;
};

export function projectSeats(
  inputs: SeatInput[],
  agreements: SurplusAgreement[] = [],
): SeatProjection[] {
  const total = inputs.reduce((s, p) => s + Math.max(0, p.averageSeats), 0);
  if (total <= 0) {
    return inputs.map((p) => ({
      partyId: p.partyId,
      seats: 0,
      share: 0,
      passedThreshold: false,
      distanceFromThreshold: -THRESHOLD,
    }));
  }

  const withShare = inputs.map((p) => {
    const share = Math.max(0, p.averageSeats) / total;
    return {
      partyId: p.partyId,
      share,
      passedThreshold: share >= THRESHOLD,
      distanceFromThreshold: share - THRESHOLD,
    };
  });

  const qualifying = withShare.filter((p) => p.passedThreshold);
  if (qualifying.length === 0) {
    return withShare.map((p) => ({ ...p, seats: 0 }));
  }

  // Renormalise over the qualifying parties only.
  const qualifyingTotal = qualifying.reduce((s, p) => s + p.share, 0);
  const votes = new Map<string, number>();
  for (const p of qualifying) votes.set(p.partyId, p.share / qualifyingTotal);

  // Surplus agreements are only valid between two parties that both cleared the
  // threshold; the pair is treated as one list for the allocation and split
  // afterwards by the same method.
  const activePairs = agreements.filter(
    ([a, b]) => votes.has(a) && votes.has(b) && a !== b,
  );
  const pairedIds = new Set(activePairs.flat());

  const blocs: { id: string; votes: number; members: string[] }[] = [];
  for (const [a, b] of activePairs) {
    blocs.push({
      id: `${a}+${b}`,
      votes: votes.get(a)! + votes.get(b)!,
      members: [a, b],
    });
  }
  for (const [partyId, v] of votes) {
    if (!pairedIds.has(partyId)) blocs.push({ id: partyId, votes: v, members: [partyId] });
  }

  const blocSeats = allocate(
    blocs.map((b) => ({ id: b.id, votes: b.votes })),
    TOTAL_SEATS,
  );

  const seats = new Map<string, number>();
  for (const bloc of blocs) {
    const n = blocSeats.get(bloc.id) ?? 0;
    if (bloc.members.length === 1) {
      seats.set(bloc.members[0], n);
      continue;
    }
    const inner = allocate(
      bloc.members.map((m) => ({ id: m, votes: votes.get(m)! })),
      n,
    );
    for (const m of bloc.members) seats.set(m, inner.get(m) ?? 0);
  }

  return withShare.map((p) => ({ ...p, seats: seats.get(p.partyId) ?? 0 }));
}

/**
 * Bader-Ofer allocation: a whole-number quota pass, then the remaining seats
 * handed out one at a time to whichever list has the highest votes/(seats+1).
 * Equivalent to d'Hondt, which is what the law prescribes.
 */
function allocate(
  lists: { id: string; votes: number }[],
  totalSeats: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const l of lists) result.set(l.id, 0);
  if (totalSeats <= 0 || lists.length === 0) return result;

  const totalVotes = lists.reduce((s, l) => s + l.votes, 0);
  if (totalVotes <= 0) return result;

  const measure = totalVotes / totalSeats;
  let assigned = 0;
  for (const l of lists) {
    const n = Math.floor(l.votes / measure);
    result.set(l.id, n);
    assigned += n;
  }

  while (assigned < totalSeats) {
    let bestId = lists[0].id;
    let bestQuotient = -Infinity;
    for (const l of lists) {
      const quotient = l.votes / (result.get(l.id)! + 1);
      // Ties broken by id so the projection is stable between renders.
      if (quotient > bestQuotient || (quotient === bestQuotient && l.id < bestId)) {
        bestQuotient = quotient;
        bestId = l.id;
      }
    }
    result.set(bestId, result.get(bestId)! + 1);
    assigned += 1;
  }

  return result;
}

/** Seats per bloc, for the "who can form a coalition" summary. */
export function seatsByBloc(
  projections: SeatProjection[],
  blocOf: Map<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of projections) {
    const bloc = blocOf.get(p.partyId) ?? "unknown";
    out.set(bloc, (out.get(bloc) ?? 0) + p.seats);
  }
  return out;
}
