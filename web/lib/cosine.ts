/**
 * Voter-recommendation matching.
 *
 * The user's answers and every party's platform are reduced to a vector over
 * the same policy axes, and the match is the cosine similarity between them,
 * rescaled from [-1, 1] to a 0-100% score. Cosine is used rather than plain
 * distance so that *direction* of opinion matters more than intensity: a voter
 * who feels mildly right-wing across the board still matches a strongly
 * right-wing party.
 */

export type Vector = Record<string, number>;

export type QuizAnswer = {
  questionId: string;
  axis: string;
  /** 1..5 Likert; 3 is neutral. */
  value: number;
  /**
   * +1 when agreeing with the statement points towards the axis' positive
   * pole, -1 when it points towards the negative one. Roughly half the
   * statements are reversed, so that a user who agrees with everything does
   * not land at an extreme.
   */
  polarity: number;
  /** Weight multiplier when the user marks the question as important. */
  important: boolean;
  /** Base weight of the question inside its axis. */
  weight: number;
  shortLabel: string;
};

export type MatchResult = {
  partyId: string;
  /** 0..100 */
  score: number;
  /** Axes that pulled the score up, strongest first. */
  agreements: { axis: string; label: string; contribution: number }[];
  /** Axes that pulled the score down, strongest first. */
  disagreements: { axis: string; label: string; contribution: number }[];
};

const IMPORTANT_MULTIPLIER = 2;

export function cosineSimilarity(a: Vector, b: Vector): number {
  const axes = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const axis of axes) {
    const x = a[axis] ?? 0;
    const y = b[axis] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Turn quiz answers into an axis vector in -1..1.
 *
 * Several questions can share an axis; they are combined as a weighted mean so
 * an axis with more questions does not automatically dominate the vector.
 */
export function answersToVector(answers: QuizAnswer[]): Vector {
  const sums = new Map<string, { wx: number; w: number }>();
  for (const a of answers) {
    const position = ((a.value - 3) / 2) * (a.polarity >= 0 ? 1 : -1); // 1..5 -> -1..1
    const weight = a.weight * (a.important ? IMPORTANT_MULTIPLIER : 1);
    const entry = sums.get(a.axis) ?? { wx: 0, w: 0 };
    entry.wx += position * weight;
    entry.w += weight;
    sums.set(a.axis, entry);
  }
  const vector: Vector = {};
  for (const [axis, { wx, w }] of sums) vector[axis] = w === 0 ? 0 : wx / w;
  return vector;
}

/** Per-axis weight of the user's answers, used to explain the result. */
export function answerWeights(answers: QuizAnswer[]): Map<string, { weight: number; label: string }> {
  const out = new Map<string, { weight: number; label: string }>();
  for (const a of answers) {
    const weight = a.weight * (a.important ? IMPORTANT_MULTIPLIER : 1);
    const entry = out.get(a.axis);
    if (entry) entry.weight += weight;
    else out.set(a.axis, { weight, label: a.shortLabel });
  }
  return out;
}

export function matchParties(
  answers: QuizAnswer[],
  partyVectors: { partyId: string; vector: Vector }[],
): MatchResult[] {
  const userVector = answersToVector(answers);
  const weights = answerWeights(answers);

  const results = partyVectors.map(({ partyId, vector }) => {
    const similarity = cosineSimilarity(userVector, vector);
    // A perfectly opposed party scores 0, an identical one 100.
    const score = Math.round(((similarity + 1) / 2) * 100);

    // Contribution of each axis to the dot product, weighted by how much the
    // user said that axis matters. This is what the explanation is built from.
    const contributions = Object.keys(userVector).map((axis) => {
      const w = weights.get(axis)?.weight ?? 1;
      return {
        axis,
        label: weights.get(axis)?.label ?? axis,
        contribution: userVector[axis] * (vector[axis] ?? 0) * w,
      };
    });

    const agreements = contributions
      .filter((c) => c.contribution > 0)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3);
    const disagreements = contributions
      .filter((c) => c.contribution < 0)
      .sort((a, b) => a.contribution - b.contribution)
      .slice(0, 3);

    return { partyId, score, agreements, disagreements };
  });

  return results.sort((a, b) => b.score - a.score || (a.partyId < b.partyId ? -1 : 1));
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
