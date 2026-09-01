import { describe, expect, it } from "vitest";
import {
  dedupePolls,
  movingAverage,
  latestAverages,
  pollWeight,
  toChartRows,
  trend,
  type RawPoll,
} from "./pollAverage";

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

describe("dedupePolls", () => {
  it("keeps only the last poll per pollster per day", () => {
    const polls = [
      poll("a", "Midgam", "2026-06-01", 500, { p1: 30 }),
      poll("b", "Midgam", "2026-06-01", 500, { p1: 32 }),
      poll("c", "Maagar", "2026-06-01", 500, { p1: 28 }),
    ];
    const out = dedupePolls(polls);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.pollster === "Midgam")!.id).toBe("b");
  });

  it("keeps the same pollster on different days", () => {
    const polls = [
      poll("a", "Midgam", "2026-06-01", 500, { p1: 30 }),
      poll("b", "Midgam", "2026-06-02", 500, { p1: 32 }),
    ];
    expect(dedupePolls(polls)).toHaveLength(2);
  });
});

describe("pollWeight", () => {
  const asOf = new Date("2026-06-15T00:00:00Z").getTime();

  it("grows with the square root of the sample size", () => {
    const small = pollWeight(poll("a", "X", "2026-06-15", 400, {}), asOf, 7);
    const large = pollWeight(poll("b", "X", "2026-06-15", 1600, {}), asOf, 7);
    expect(large / small).toBeCloseTo(2, 5);
  });

  it("halves after one half-life", () => {
    const fresh = pollWeight(poll("a", "X", "2026-06-15", 500, {}), asOf, 7);
    const week = pollWeight(poll("b", "X", "2026-06-08", 500, {}), asOf, 7);
    expect(week / fresh).toBeCloseTo(0.5, 5);
  });
});

describe("movingAverage", () => {
  it("returns the poll value itself when there is a single poll", () => {
    const points = movingAverage([poll("a", "X", "2026-06-01", 500, { p1: 30 })], ["p1"]);
    expect(points).toHaveLength(1);
    expect(points[0].mean).toBe(30);
    expect(points[0].date).toBe("2026-06-01");
  });

  it("smooths noise between two equally weighted same-day polls", () => {
    const points = movingAverage(
      [
        poll("a", "X", "2026-06-01", 500, { p1: 28 }),
        poll("b", "Y", "2026-06-01", 500, { p1: 32 }),
      ],
      ["p1"],
    );
    expect(points[0].mean).toBe(30);
    expect(points[0].pollCount).toBe(2);
    // The spread between the two polls shows up as an uncertainty band.
    expect(points[0].hi).toBeGreaterThan(points[0].mean);
    expect(points[0].lo).toBeLessThan(points[0].mean);
  });

  it("weights a larger sample more heavily", () => {
    const points = movingAverage(
      [
        poll("a", "X", "2026-06-01", 400, { p1: 20 }),
        poll("b", "Y", "2026-06-01", 1600, { p1: 30 }),
      ],
      ["p1"],
    );
    // Weights are 20 and 40 -> (20*20 + 30*40)/60 = 26.67
    expect(points[0].mean).toBeCloseTo(26.7, 1);
  });

  it("emits a continuous series across days with no polls", () => {
    const points = movingAverage(
      [
        poll("a", "X", "2026-06-01", 500, { p1: 30 }),
        poll("b", "X", "2026-06-05", 500, { p1: 34 }),
      ],
      ["p1"],
      { windowDays: 14 },
    );
    expect(points.map((p) => p.date)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ]);
  });

  it("drops polls that fall out of the window", () => {
    const points = movingAverage(
      [
        poll("a", "X", "2026-06-01", 500, { p1: 10 }),
        poll("b", "Y", "2026-06-20", 500, { p1: 30 }),
      ],
      ["p1"],
      { windowDays: 7 },
    );
    const last = points[points.length - 1];
    expect(last.date).toBe("2026-06-20");
    expect(last.pollCount).toBe(1);
    expect(last.mean).toBe(30);
  });

  it("treats a party absent from a poll as zero seats", () => {
    const points = movingAverage(
      [
        poll("a", "X", "2026-06-01", 500, { p1: 30, p2: 4 }),
        poll("b", "Y", "2026-06-01", 500, { p1: 30 }),
      ],
      ["p2"],
    );
    expect(points[0].mean).toBe(2);
  });

  it("returns nothing for empty input", () => {
    expect(movingAverage([], ["p1"])).toEqual([]);
    expect(movingAverage([poll("a", "X", "2026-06-01", 500, { p1: 1 })], [])).toEqual([]);
  });
});

describe("latestAverages and trend", () => {
  const polls = [
    poll("a", "X", "2026-06-01", 500, { p1: 30, p2: 10 }),
    poll("b", "X", "2026-06-08", 500, { p1: 34, p2: 8 }),
  ];

  it("finds the newest point per party", () => {
    const latest = latestAverages(movingAverage(polls, ["p1", "p2"], { windowDays: 1 }));
    expect(latest.get("p1")!.mean).toBe(34);
    expect(latest.get("p2")!.mean).toBe(8);
  });

  it("reports the direction of movement over the period", () => {
    const t = trend(movingAverage(polls, ["p1", "p2"], { windowDays: 1 }), 7);
    expect(t.get("p1")).toBe(4);
    expect(t.get("p2")).toBe(-2);
  });
});

describe("toChartRows", () => {
  it("pivots to one row per date with a column per party", () => {
    const rows = toChartRows(
      movingAverage([poll("a", "X", "2026-06-01", 500, { p1: 30, p2: 10 })], ["p1", "p2"]),
    );
    expect(rows).toEqual([{ date: "2026-06-01", p1: 30, p2: 10 }]);
  });
});
