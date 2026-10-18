import { describe, expect, it } from "vitest";
import {
  answerPosition,
  maskedCosine,
  matchBlocs,
  matchParties,
  shrink,
  toPercent,
  type PartyVector,
  type QuizAnswer,
} from "./cosine";

// The cases mirror the checks in research/07_match_function.ipynb, so the
// notebook and the site agree on what a match is.

function answer(questionId: string, value: number, important = false, weight = 1): QuizAnswer {
  return { questionId, value, important, weight, shortLabel: questionId };
}

describe("answerPosition", () => {
  it("maps the Likert scale onto -1..1 with 3 as neutral", () => {
    expect([1, 2, 3, 4, 5].map(answerPosition)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
});

describe("maskedCosine", () => {
  const one = { q01: 1 };

  it("can only be +1 or -1 on a single shared question", () => {
    expect(maskedCosine({ q01: 0.5 }, { q01: 1 }, one)).toEqual({ cos: 1, shared: 1 });
    expect(maskedCosine({ q01: -0.5 }, { q01: 1 }, one)).toEqual({ cos: -1, shared: 1 });
  });

  it("ignores questions only one side has", () => {
    expect(maskedCosine({ q01: 1, q02: -1 }, { q01: 1, q03: 1 }, { q01: 1, q02: 1 })).toEqual({
      cos: 1,
      shared: 1,
    });
  });

  it("is 0, not NaN, with nothing shared or a neutral user", () => {
    expect(maskedCosine({ q01: 1 }, { q02: 1 }, one)).toEqual({ cos: 0, shared: 0 });
    expect(maskedCosine({ q01: 0 }, { q01: 1 }, one)).toEqual({ cos: 0, shared: 1 });
  });

  it("lets a heavier question pull the score its way", () => {
    const user = { q01: 1, q02: 1 };
    const party = { q01: 1, q02: -1 };
    expect(maskedCosine(user, party, { q01: 1, q02: 1 }).cos).toBeCloseTo(0, 9);
    expect(maskedCosine(user, party, { q01: 3, q02: 1 }).cos).toBeGreaterThan(0.4);
  });
});

describe("shrink and toPercent", () => {
  it("pulls a score towards 0 by n/(n+k)", () => {
    expect(shrink(1, 1, 3)).toBe(0.25);
    expect(shrink(0.75, 15, 3)).toBeCloseTo((0.75 * 15) / 18, 12);
    expect(shrink(1, 5, 0)).toBe(1);
    expect(shrink(0, 0, 0)).toBe(0);
  });

  it("maps -1..1 onto 0..100 with no information at 50", () => {
    expect([-1, 0, 1].map(toPercent)).toEqual([0, 50, 100]);
  });
});

describe("matchParties", () => {
  const parties: PartyVector[] = [
    { partyId: "aligned", vector: { q01: 1, q02: 1 } },
    { partyId: "opposed", vector: { q01: -1, q02: -1 } },
    { partyId: "unknown", vector: { q09: 1 } },
  ];
  const answers = [answer("q01", 5), answer("q02", 5)];

  it("ranks agreement above ignorance above disagreement", () => {
    const results = matchParties(answers, parties);
    expect(results.map((r) => r.partyId)).toEqual(["aligned", "unknown", "opposed"]);
    expect(results.find((r) => r.partyId === "unknown")).toMatchObject({ score: 50, shared: 0 });
  });

  it("does not give 100% for agreeing on a single question", () => {
    const [result] = matchParties([answer("q01", 5)], [{ partyId: "p", vector: { q01: 1 } }]);
    expect(result.score).toBe(Math.round(toPercent(1 / 11)));
  });

  it("ranks a party that agrees on many questions above one that agrees on one", () => {
    // The case that motivated the shrinkage: B agrees on 13 of 15, A on 1 of 1.
    const qs = Array.from({ length: 15 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`);
    const many = Object.fromEntries(qs.map((q, i) => [q, i < 13 ? 1 : -1]));
    const results = matchParties(
      qs.map((q) => answer(q, 5)),
      [
        { partyId: "a", vector: { q01: 1 } },
        { partyId: "b", vector: many },
      ],
    );
    expect(results[0].partyId).toBe("b");
  });

  it("explains a score with the questions and their evidence", () => {
    const [result] = matchParties(
      [answer("q01", 5), answer("q02", 1)],
      [
        {
          partyId: "p",
          vector: { q01: 1, q02: 1 },
          evidence: { q01: { kind: "bill", text: "הצעת חוק", url: "https://example.org/b" } },
        },
      ],
    );
    expect(result.agreements.map((r) => r.questionId)).toEqual(["q01"]);
    expect(result.agreements[0].evidence?.url).toBe("https://example.org/b");
    expect(result.disagreements.map((r) => r.questionId)).toEqual(["q02"]);
  });

  it("returns at most three reasons on each side", () => {
    const qs = ["q01", "q02", "q03", "q04", "q05"];
    const [result] = matchParties(
      qs.map((q) => answer(q, 5)),
      [{ partyId: "p", vector: Object.fromEntries(qs.map((q) => [q, 1])) }],
    );
    expect(result.agreements).toHaveLength(3);
  });
});

describe("matchBlocs", () => {
  it("weights party scores by their projected seats", () => {
    const matches = matchParties(
      [answer("q01", 5)],
      [
        { partyId: "big", vector: { q01: 1 } },
        { partyId: "small", vector: { q01: -1 } },
      ],
      0,
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
    const matches = matchParties([answer("q01", 5)], [{ partyId: "out", vector: { q01: 1 } }]);
    expect(matchBlocs(matches, new Map([["out", "right"]]), new Map([["out", 0]]))).toEqual([]);
  });
});
