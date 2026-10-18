import { describe, expect, it } from "vitest";
import type { HouseEffects } from "./houseEffects";
import type { RawPoll } from "./pollAverage";
import { projectSeats } from "./seats";
import {
  SD_FLOOR,
  majorityProbability,
  partySpread,
  simulate,
  thresholdProbability,
  type SimParty,
} from "./coalitionSim";

const asOf = new Date("2026-10-15T12:00:00Z");

function poll(id: string, pollster: string, day: number, results: Record<string, number>): RawPoll {
  return {
    id,
    pollster,
    fieldDateEnd: new Date(Date.UTC(2026, 9, day, 12)),
    sampleSize: 700,
    results: Object.entries(results).map(([partyId, seats]) => ({ partyId, seats })),
  };
}

describe("partySpread", () => {
  // Firm A always gives x four seats more than firm B.
  const polls = [
    poll("1", "A", 10, { x: 24 }),
    poll("2", "B", 10, { x: 20 }),
    poll("3", "A", 13, { x: 24 }),
    poll("4", "B", 13, { x: 20 }),
  ];
  const means = new Map([["x", 22]]);

  it("counts a firm's steady lean as spread when house effects are ignored", () => {
    expect(partySpread(polls, means, { asOf }).get("x")!).toBeGreaterThan(2);
  });

  it("removes that lean once house effects are applied", () => {
    const effects: HouseEffects = new Map([
      ["A", new Map([["x", 2]])],
      ["B", new Map([["x", -2]])],
    ]);
    expect(partySpread(polls, means, { asOf, houseEffects: effects }).get("x")).toBe(SD_FLOOR);
  });

  it("never goes below the floor", () => {
    const flat = [poll("1", "A", 12, { x: 8 }), poll("2", "B", 13, { x: 8 })];
    expect(partySpread(flat, new Map([["x", 8]]), { asOf }).get("x")).toBe(SD_FLOOR);
  });

  it("ignores polls outside the window", () => {
    const old = [poll("old", "A", 1, { x: 40 }), ...polls];
    expect(partySpread(old, means, { asOf, windowDays: 7 })).toEqual(partySpread(polls, means, { asOf, windowDays: 7 }));
  });
});

const parties: SimParty[] = [
  { id: "a", bloc: "left", mean: 35, sd: 3 },
  { id: "b", bloc: "left", mean: 25, sd: 3 },
  { id: "c", bloc: "right", mean: 50, sd: 3 },
  { id: "d", bloc: "right", mean: 6, sd: 2 },
  { id: "e", bloc: "right", mean: 4, sd: 1 },
];

describe("simulate", () => {
  it("gives whole seats summing to 120 in every simulated election", () => {
    const draws = simulate(parties, { n: 500 });
    for (let row = 0; row < 500; row++) {
      let total = 0;
      for (let i = 0; i < parties.length; i++) total += draws[row * parties.length + i];
      expect(total).toBe(120);
    }
  });

  it("is the plain projection when nothing is uncertain", () => {
    const certain = parties.map((p) => ({ ...p, sd: 0 }));
    const expected = projectSeats(certain.map((p) => ({ partyId: p.id, averageSeats: p.mean }))).map((p) => p.seats);
    const draws = simulate(certain, { n: 3 });
    expect([...draws.slice(0, parties.length)]).toEqual(expected);
    expect([...draws.slice(parties.length * 2)]).toEqual(expected);
  });

  it("applies surplus agreements in every draw, as the projection does", () => {
    const certain = parties.map((p) => ({ ...p, sd: 0 }));
    const agreements: [string, string][] = [["d", "e"]];
    const expected = projectSeats(
      certain.map((p) => ({ partyId: p.id, averageSeats: p.mean })),
      agreements,
    ).map((p) => p.seats);
    expect([...simulate(certain, { n: 1, agreements })]).toEqual(expected);
  });

  it("repeats itself for the same seed", () => {
    expect(simulate(parties, { n: 200, seed: 7 })).toEqual(simulate(parties, { n: 200, seed: 7 }));
    expect(simulate(parties, { n: 200, seed: 7 })).not.toEqual(simulate(parties, { n: 200, seed: 8 }));
  });

  it("lets a bloc reach a far target more often when its errors move together", () => {
    // a + b average 60 and need 66: only a joint surprise gets them there.
    const left = [0, 1];
    const independent = majorityProbability(simulate(parties, { n: 4000, correlation: 0 }), 5, left, 66);
    const together = majorityProbability(simulate(parties, { n: 4000, correlation: 0.9 }), 5, left, 66);
    expect(together).toBeGreaterThan(independent);
  });
});

describe("majorityProbability and thresholdProbability", () => {
  // Two simulated elections, three parties.
  const draws = Uint8Array.from([60, 55, 5, 62, 58, 0]);

  it("counts the elections in which the members reach the majority", () => {
    expect(majorityProbability(draws, 3, [0])).toBe(0.5);
    expect(majorityProbability(draws, 3, [0, 2])).toBe(1);
    expect(majorityProbability(draws, 3, [])).toBe(0);
  });

  it("counts the elections in which each party won seats", () => {
    expect(thresholdProbability(draws, 3)).toEqual([1, 1, 0.5]);
  });
});
