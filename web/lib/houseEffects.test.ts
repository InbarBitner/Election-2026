import { describe, expect, it } from "vitest";
import {
  doubleCentre,
  estimateHouseEffects,
  houseEffectMagnitude,
  shrink,
} from "./houseEffects";
import { movingAverage, type RawPoll } from "./pollAverage";

function poll(
  id: string,
  pollster: string,
  date: string,
  sampleSize: number,
  results: Record<string, number>,
): RawPoll {
  return {
    id,
    pollster,
    fieldDateEnd: new Date(`${date}T00:00:00Z`),
    sampleSize,
    results: Object.entries(results).map(([partyId, seats]) => ({ partyId, seats })),
  };
}

/**
 * A field of three firms polling a steady electorate, where one of them leans.
 *
 * `Leaner` reports the first party 6 seats high and the second 6 low, every
 * time. The other two agree with each other exactly. Anything that claims to
 * measure house effects has to find this.
 */
function leaningField(): RawPoll[] {
  const polls: RawPoll[] = [];
  for (let day = 1; day <= 12; day += 1) {
    const date = `2026-06-${String(day).padStart(2, "0")}`;
    polls.push(poll(`a${day}`, "Steady", date, 500, { p1: 40, p2: 40, p3: 40 }));
    polls.push(poll(`b${day}`, "AlsoSteady", date, 500, { p1: 40, p2: 40, p3: 40 }));
    polls.push(poll(`c${day}`, "Leaner", date, 500, { p1: 46, p2: 34, p3: 40 }));
  }
  return polls;
}

describe("shrink", () => {
  it("keeps almost none of a lean seen once", () => {
    expect(shrink(3, 1, 5)).toBeCloseTo(0.5, 5);
  });

  it("keeps half of a lean seen five times", () => {
    expect(shrink(3, 5, 5)).toBeCloseTo(1.5, 5);
  });

  it("approaches the raw estimate as evidence accumulates", () => {
    expect(shrink(3, 200, 5)).toBeGreaterThan(2.9);
  });

  it("is zero without evidence", () => {
    expect(shrink(3, 0, 5)).toBe(0);
  });
});

describe("doubleCentre", () => {
  it("leaves every row and every column summing to zero", () => {
    const matrix = new Map([
      ["a", new Map([["p1", 3], ["p2", -1], ["p3", 5]])],
      ["b", new Map([["p1", -2], ["p2", 7], ["p3", 0]])],
      ["c", new Map([["p1", 1], ["p2", 1], ["p3", -4]])],
    ]);
    doubleCentre(matrix);

    for (const [, row] of matrix) {
      expect([...row.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(0, 10);
    }
    for (const partyId of ["p1", "p2", "p3"]) {
      const column = [...matrix.values()].map((row) => row.get(partyId)!);
      expect(column.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 10);
    }
  });
});

describe("estimateHouseEffects", () => {
  it("finds the direction and rough size of a real lean", () => {
    const effects = estimateHouseEffects(leaningField(), ["p1", "p2", "p3"]);
    const leaner = effects.get("Leaner")!;

    expect(leaner.get("p1")!).toBeGreaterThan(3);
    expect(leaner.get("p2")!).toBeLessThan(-3);
    expect(Math.abs(leaner.get("p3")!)).toBeLessThan(0.5);
  });

  it("names the leaning firm as the one furthest from the field", () => {
    const ranked = houseEffectMagnitude(estimateHouseEffects(leaningField(), ["p1", "p2", "p3"]));
    expect(ranked[0].pollster).toBe("Leaner");
  });

  it("leaves a firm's corrections summing to zero, so a corrected poll still totals 120", () => {
    const parties = ["p1", "p2", "p3"];
    const effects = estimateHouseEffects(leaningField(), parties);
    for (const [, row] of effects) {
      expect([...row.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(0, 10);
    }
  });

  it("does not move the consensus, only the firms relative to it", () => {
    // Every party's corrections cancel across firms. Without this the whole
    // average could drift, which would be inventing a result.
    const effects = estimateHouseEffects(leaningField(), ["p1", "p2", "p3"]);
    for (const partyId of ["p1", "p2", "p3"]) {
      const column = [...effects.values()].map((row) => row.get(partyId) ?? 0);
      expect(column.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 10);
    }
  });

  it("finds nothing when the firms already agree", () => {
    const polls: RawPoll[] = [];
    for (let day = 1; day <= 8; day += 1) {
      const date = `2026-06-0${day}`;
      polls.push(poll(`a${day}`, "A", date, 500, { p1: 40, p2: 80 }));
      polls.push(poll(`b${day}`, "B", date, 500, { p1: 40, p2: 80 }));
    }
    const effects = estimateHouseEffects(polls, ["p1", "p2"]);
    for (const [, row] of effects) {
      for (const value of row.values()) expect(Math.abs(value)).toBeLessThan(1e-9);
    }
  });

  it("does not measure a firm against itself", () => {
    // Two thirds of the polls here are the leaner's. Comparing each poll to
    // everything around it, its own output included, would average its lean
    // into the very benchmark meant to expose it.
    const polls: RawPoll[] = [];
    for (let day = 1; day <= 9; day += 1) {
      const date = `2026-06-0${day}`;
      polls.push(poll(`x${day}`, "Loud", date, 500, { p1: 50, p2: 70 }));
      polls.push(poll(`y${day}`, "Loud2", date, 500, { p1: 50, p2: 70 }));
      polls.push(poll(`z${day}`, "Quiet", date, 500, { p1: 40, p2: 80 }));
    }
    // "Loud" and "Loud2" are distinct firms agreeing with each other, so the
    // field really does sit at 50 and Quiet is the outlier.
    const effects = estimateHouseEffects(polls, ["p1", "p2"]);
    expect(effects.get("Quiet")!.get("p1")!).toBeLessThan(-4);
    expect(effects.get("Loud")!.get("p1")!).toBeGreaterThan(0);
  });

  it("shrugs at a single poll rather than trusting it", () => {
    const polls = [
      ...leaningField(),
      poll("one", "Newcomer", "2026-06-06", 500, { p1: 60, p2: 20, p3: 40 }),
    ];
    const effects = estimateHouseEffects(polls, ["p1", "p2", "p3"]);
    // Raw residual is about +18; one poll of evidence must not buy that.
    expect(effects.get("Newcomer")!.get("p1")!).toBeLessThan(5);
  });

  it("leaves the average alone while every firm is polling", () => {
    // Worth pinning down, because it looks at first like the correction doing
    // nothing. When all three firms are in the window, the raw average already
    // sits at the middle of the field, and the corrections — which sum to zero
    // across firms by construction — move each poll onto that middle without
    // moving the middle. That is right: with a balanced field there is no
    // evidence about who is *correct*, only about who differs.
    const parties = ["p1", "p2", "p3"];
    const polls = leaningField();
    const effects = estimateHouseEffects(polls, parties);

    const last = (points: ReturnType<typeof movingAverage>, partyId: string) =>
      points.filter((p) => p.partyId === partyId).at(-1)!.mean;

    expect(last(movingAverage(polls, parties, { houseEffects: effects }), "p1")).toBeCloseTo(
      last(movingAverage(polls, parties), "p1"),
      5,
    );
  });

  it("stops a lone firm from moving the average when it is the only one publishing", () => {
    // This is what the correction is actually for. The field goes quiet and
    // only the leaning firm reports for a few days — a completely ordinary
    // situation over a holiday or a weekend. Uncorrected, the average lurches
    // towards that firm and the chart shows a swing that never happened.
    const parties = ["p1", "p2", "p3"];
    const polls = leaningField();
    const effects = estimateHouseEffects(polls, parties);
    for (const day of [13, 14, 15, 16, 17]) {
      polls.push(poll(`c${day}`, "Leaner", `2026-06-${day}`, 500, { p1: 46, p2: 34, p3: 40 }));
    }

    const last = (points: ReturnType<typeof movingAverage>, partyId: string) =>
      points.filter((p) => p.partyId === partyId).at(-1)!.mean;

    const raw = last(movingAverage(polls, parties), "p1");
    const corrected = last(movingAverage(polls, parties, { houseEffects: effects }), "p1");

    // The leaner's fresh polls dominate the decayed window and drag the raw
    // average up towards its own 46.
    // Nothing moved in the electorate, so the truthful answer is still 42.
    expect(raw).toBeGreaterThan(43);
    expect(corrected).toBeLessThan(42.1);
    expect(raw - corrected).toBeGreaterThan(1);
  });
});
