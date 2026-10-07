import { describe, expect, it } from "vitest";
import {
  answersToVector,
  cosineSimilarity,
  matchBlocs,
  matchParties,
  type QuizAnswer,
  type Vector,
} from "./cosine";

function answer(
  questionId: string,
  axis: string,
  value: number,
  important = false,
  polarity = 1,
): QuizAnswer {
  return { questionId, axis, value, important, polarity, weight: 1, shortLabel: axis };
}

describe("cosineSimilarity", () => {
  it("is 1 for identical directions", () => {
    expect(cosineSimilarity({ x: 1, y: 1 }, { x: 2, y: 2 })).toBeCloseTo(1, 6);
  });

  it("is -1 for opposite directions", () => {
    expect(cosineSimilarity({ x: 1, y: 1 }, { x: -1, y: -1 })).toBeCloseTo(-1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(0, 6);
  });

  it("returns 0 rather than NaN for a zero vector", () => {
    expect(cosineSimilarity({ x: 0 }, { x: 1 })).toBe(0);
  });

  it("treats a missing axis as zero", () => {
    expect(cosineSimilarity({ x: 1 }, { x: 1, y: 5 })).toBeCloseTo(1 / Math.sqrt(26), 6);
  });
});

describe("answersToVector", () => {
  it("maps the Likert scale onto -1..1 with 3 as neutral", () => {
    expect(answersToVector([answer("q1", "security", 5)])).toEqual({ security: 1 });
    expect(answersToVector([answer("q2", "security", 1)])).toEqual({ security: -1 });
    expect(answersToVector([answer("q3", "security", 3)])).toEqual({ security: 0 });
  });

  it("averages several questions on the same axis", () => {
    const v = answersToVector([answer("q1", "economy", 5), answer("q2", "economy", 3)]);
    expect(v.economy).toBeCloseTo(0.5, 6);
  });

  it("flips a reversed statement onto the other pole", () => {
    // Agreeing with a polarity -1 statement must land on the negative pole.
    expect(answersToVector([answer("q1", "security", 5, false, -1)])).toEqual({
      security: -1,
    });
    expect(answersToVector([answer("q2", "security", 1, false, -1)])).toEqual({
      security: 1,
    });
  });

  it("cancels out when the user agrees with both a statement and its reverse", () => {
    const v = answersToVector([
      answer("q1", "security", 5, false, 1),
      answer("q2", "security", 5, false, -1),
    ]);
    expect(v.security).toBeCloseTo(0, 6);
  });

  it("gives an important question double weight", () => {
    const v = answersToVector([
      answer("q1", "economy", 5, true),
      answer("q2", "economy", 3),
    ]);
    // (1*2 + 0*1) / 3
    expect(v.economy).toBeCloseTo(2 / 3, 6);
  });
});

describe("matchParties", () => {
  const parties: { partyId: string; vector: Vector }[] = [
    { partyId: "aligned", vector: { security: 1, economy: 1 } },
    { partyId: "opposed", vector: { security: -1, economy: -1 } },
    { partyId: "orthogonal", vector: { religion: 1 } },
  ];
  const answers = [answer("q1", "security", 5), answer("q2", "economy", 5)];

  it("scores an identical party 100 and an opposite one 0", () => {
    const results = matchParties(answers, parties);
    expect(results[0].partyId).toBe("aligned");
    expect(results[0].score).toBe(100);
    expect(results.find((r) => r.partyId === "opposed")!.score).toBe(0);
    expect(results.find((r) => r.partyId === "orthogonal")!.score).toBe(50);
  });

  it("is sorted from best match to worst", () => {
    const scores = matchParties(answers, parties).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("explains the score with agreeing and disagreeing axes", () => {
    const results = matchParties(
      [answer("q1", "security", 5), answer("q2", "economy", 1)],
      [{ partyId: "p", vector: { security: 1, economy: 1 } }],
    );
    expect(results[0].agreements.map((a) => a.axis)).toEqual(["security"]);
    expect(results[0].disagreements.map((a) => a.axis)).toEqual(["economy"]);
  });

  it("returns at most three reasons on each side", () => {
    const many = ["a", "b", "c", "d", "e"].map((ax, i) => answer(`q${i}`, ax, 5));
    const vector = Object.fromEntries(["a", "b", "c", "d", "e"].map((ax) => [ax, 1]));
    const results = matchParties(many, [{ partyId: "p", vector }]);
    expect(results[0].agreements).toHaveLength(3);
  });
});

describe("matchBlocs", () => {
  it("weights party scores by their projected seats", () => {
    const matches = matchParties(
      [answer("q1", "security", 5)],
      [
        { partyId: "big", vector: { security: 1 } },
        { partyId: "small", vector: { security: -1 } },
      ],
    );
    const blocs = matchBlocs(
      matches,
      new Map([
        ["big", "right"],
        ["small", "right"],
      ]),
      new Map([
        ["big", 30],
        ["small", 10],
      ]),
    );
    // (100*30 + 0*10) / 40
    expect(blocs[0].score).toBe(75);
  });

  it("ignores parties with no projected seats", () => {
    const matches = matchParties(
      [answer("q1", "security", 5)],
      [{ partyId: "out", vector: { security: 1 } }],
    );
    expect(matchBlocs(matches, new Map([["out", "right"]]), new Map([["out", 0]]))).toEqual([]);
  });
});
