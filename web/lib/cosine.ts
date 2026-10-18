/**
 * Voter-recommendation matching.
 *
 * Both sides are compared question by question. A party's position on each
 * quiz statement comes from hand labels of its platform or its MKs' bills
 * (data/positions/party_positions.json): +1 agrees with the statement, -1
 * disagrees, 0 takes no side, and a question the party is not covered on is
 * absent. The user's answer is placed on the same scale, so no polarity is
 * needed: both are measured against the same sentence.
 *
 * The similarity is a weighted cosine over the questions both sides have a
 * position on, and nothing else. Treating a missing party position as 0 would
 * read "we don't know" as "takes no side".
 *
 * Masking alone rewards ignorance: with one shared question the cosine can
 * only be +1 or -1, so a party we know little about can hit 100% by chance.
 * The score is therefore shrunk towards 0 ("no information", 50%) by
 * n / (n + k), n being the number of shared questions. k = 10 was chosen in
 * research/08_bias_diagnostics.ipynb: against random answers the parties'
 * win rates barely depend on how many positions we have for them (Spearman
 * -0.19), while 80% of simulated voters who think like a party get it first.
 * Re-run that notebook before changing k or after adding many positions.
 *
 * The method was worked out in research/07_match_function.ipynb, and the tests
 * in cosine.test.ts repeat its checks.
 */

export type Vector = Record<string, number>;

export type QuizAnswer = {
  questionId: string;
  /** 1..5 Likert; 3 is neutral. */
  value: number;
  /** Weight multiplier when the user marks the question as important. */
  important: boolean;
  /** Base weight of the question. */
  weight: number;
  shortLabel: string;
};

/** The platform passage or bill a party's position rests on. */
export type Evidence = {
  kind: "platform" | "bill";
  text: string;
  url?: string;
  /** A bill's legislative status. */
  status?: string;
};

export type Reason = {
  questionId: string;
  label: string;
  /** Signed share of the weighted dot product: positive pulls the score up. */
  contribution: number;
  evidence?: Evidence;
};

export type MatchResult = {
  partyId: string;
  /** 0..100; 50 means no information either way. */
  score: number;
  /** How many answered questions the party has a position on. */
  shared: number;
  /** Questions that pulled the score up, strongest first. */
  agreements: Reason[];
  /** Questions that pulled the score down, strongest first. */
  disagreements: Reason[];
};

export type PartyVector = {
  partyId: string;
  vector: Vector;
  evidence?: Record<string, Evidence>;
};

export const IMPORTANT_MULTIPLIER = 2;
export const SHRINKAGE_K = 10;
const REASONS_PER_SIDE = 3;

/** 1..5 → -1..1, with 3 as 0. */
export function answerPosition(value: number): number {
  return (value - 3) / 2;
}

/** The weighted cosine over the questions both vectors have, and how many there are. */
export function maskedCosine(
  user: Vector,
  party: Vector,
  weights: Vector,
): { cos: number; shared: number } {
  const shared = Object.keys(user).filter((q) => q in party);
  let dot = 0;
  let sumUser = 0;
  let sumParty = 0;
  for (const q of shared) {
    const w = weights[q] ?? 1;
    dot += w * user[q] * party[q];
    sumUser += w * user[q] ** 2;
    sumParty += w * party[q] ** 2;
  }
  if (sumUser === 0 || sumParty === 0) return { cos: 0, shared: shared.length };
  return { cos: dot / (Math.sqrt(sumUser) * Math.sqrt(sumParty)), shared: shared.length };
}

/** Pull a cosine towards 0 the fewer questions it rests on. */
export function shrink(cos: number, shared: number, k = SHRINKAGE_K): number {
  return shared + k === 0 ? 0 : (cos * shared) / (shared + k);
}

/** -1..1 → 0..100. */
export function toPercent(score: number): number {
  return (score + 1) * 50;
}

export function matchParties(
  answers: QuizAnswer[],
  parties: PartyVector[],
  k = SHRINKAGE_K,
): MatchResult[] {
  const user: Vector = {};
  const weights: Vector = {};
  const labels = new Map<string, string>();
  for (const a of answers) {
    user[a.questionId] = answerPosition(a.value);
    weights[a.questionId] = a.weight * (a.important ? IMPORTANT_MULTIPLIER : 1);
    labels.set(a.questionId, a.shortLabel);
  }

  const results = parties.map(({ partyId, vector, evidence }) => {
    const { cos, shared } = maskedCosine(user, vector, weights);
    const score = shrink(cos, shared, k);

    const reasons: Reason[] = Object.keys(user)
      .filter((q) => q in vector)
      .map((q) => ({
        questionId: q,
        label: labels.get(q) ?? q,
        contribution: weights[q] * user[q] * vector[q],
        evidence: evidence?.[q],
      }));

    return {
      raw: score,
      result: {
        partyId,
        score: Math.round(toPercent(score)),
        shared,
        agreements: reasons
          .filter((r) => r.contribution > 0)
          .sort((a, b) => b.contribution - a.contribution)
          .slice(0, REASONS_PER_SIDE),
        disagreements: reasons
          .filter((r) => r.contribution < 0)
          .sort((a, b) => a.contribution - b.contribution)
          .slice(0, REASONS_PER_SIDE),
      },
    };
  });

  return results
    .sort((a, b) => b.raw - a.raw || (a.result.partyId < b.result.partyId ? -1 : 1))
    .map((r) => r.result);
}

/**
 * Bloc-level match: the average of the member parties' scores, weighted by
 * their projected seats, so a bloc's score reflects its actual composition.
 */
export function matchBlocs(
  matches: MatchResult[],
  blocOf: Map<string, string>,
  seatsOf: Map<string, number>,
): { bloc: string; score: number }[] {
  const acc = new Map<string, { ws: number; w: number }>();
  for (const m of matches) {
    const bloc = blocOf.get(m.partyId);
    if (!bloc) continue;
    const w = Math.max(0, seatsOf.get(m.partyId) ?? 0);
    if (w === 0) continue;
    const entry = acc.get(bloc) ?? { ws: 0, w: 0 };
    entry.ws += m.score * w;
    entry.w += w;
    acc.set(bloc, entry);
  }
  return [...acc.entries()]
    .map(([bloc, { ws, w }]) => ({ bloc, score: Math.round(ws / w) }))
    .sort((a, b) => b.score - a.score);
}
