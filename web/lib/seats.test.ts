import { describe, expect, it } from "vitest";
import { projectSeats, seatsByBloc, THRESHOLD, TOTAL_SEATS } from "./seats";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("projectSeats", () => {
  it("always allocates exactly 120 seats", () => {
    const out = projectSeats([
      { partyId: "a", averageSeats: 32 },
      { partyId: "b", averageSeats: 24 },
      { partyId: "c", averageSeats: 18 },
      { partyId: "d", averageSeats: 11 },
      { partyId: "e", averageSeats: 9 },
      { partyId: "f", averageSeats: 8 },
      { partyId: "g", averageSeats: 7 },
      { partyId: "h", averageSeats: 6 },
      { partyId: "i", averageSeats: 5 },
    ]);
    expect(sum(out.map((p) => p.seats))).toBe(TOTAL_SEATS);
  });

  it("gives zero seats to a party below the threshold", () => {
    const out = projectSeats([
      { partyId: "big", averageSeats: 60 },
      { partyId: "mid", averageSeats: 57 },
      { partyId: "small", averageSeats: 3 },
    ]);
    const small = out.find((p) => p.partyId === "small")!;
    // 3 / 120 = 2.5% < 3.25%
    expect(small.passedThreshold).toBe(false);
    expect(small.seats).toBe(0);
    expect(small.distanceFromThreshold).toBeLessThan(0);
    expect(sum(out.map((p) => p.seats))).toBe(TOTAL_SEATS);
  });

  it("redistributes the seats of a party that misses the threshold", () => {
    const withSmall = projectSeats([
      { partyId: "a", averageSeats: 60 },
      { partyId: "b", averageSeats: 57 },
      { partyId: "small", averageSeats: 3 },
    ]);
    const seatsA = withSmall.find((p) => p.partyId === "a")!.seats;
    expect(seatsA).toBeGreaterThan(60);
  });

  it("keeps a party that is exactly at the threshold", () => {
    const atThreshold = THRESHOLD * 120; // 3.9 seats
    const out = projectSeats([
      { partyId: "a", averageSeats: 120 - atThreshold },
      { partyId: "b", averageSeats: atThreshold },
    ]);
    expect(out.find((p) => p.partyId === "b")!.passedThreshold).toBe(true);
  });

  it("is deterministic when two parties are exactly tied", () => {
    const first = projectSeats([
      { partyId: "a", averageSeats: 40 },
      { partyId: "b", averageSeats: 40 },
      { partyId: "c", averageSeats: 40 },
    ]);
    const second = projectSeats([
      { partyId: "c", averageSeats: 40 },
      { partyId: "b", averageSeats: 40 },
      { partyId: "a", averageSeats: 40 },
    ]);
    const asMap = (r: typeof first) => Object.fromEntries(r.map((p) => [p.partyId, p.seats]));
    expect(asMap(first)).toEqual(asMap(second));
    expect(sum(first.map((p) => p.seats))).toBe(TOTAL_SEATS);
  });

  it("a surplus agreement never costs the pair seats", () => {
    const inputs = [
      { partyId: "a", averageSeats: 35 },
      { partyId: "b", averageSeats: 30 },
      { partyId: "c", averageSeats: 29 },
      { partyId: "d", averageSeats: 26 },
    ];
    const without = projectSeats(inputs);
    const withPact = projectSeats(inputs, [["c", "d"]]);
    const pairSeats = (r: typeof without) =>
      r.filter((p) => p.partyId === "c" || p.partyId === "d").reduce((s, p) => s + p.seats, 0);
    expect(pairSeats(withPact)).toBeGreaterThanOrEqual(pairSeats(without));
    expect(sum(withPact.map((p) => p.seats))).toBe(TOTAL_SEATS);
  });

  it("ignores a surplus agreement when one side missed the threshold", () => {
    const inputs = [
      { partyId: "a", averageSeats: 60 },
      { partyId: "b", averageSeats: 57 },
      { partyId: "small", averageSeats: 3 },
    ];
    const out = projectSeats(inputs, [["b", "small"]]);
    expect(out.find((p) => p.partyId === "small")!.seats).toBe(0);
    expect(sum(out.map((p) => p.seats))).toBe(TOTAL_SEATS);
  });

  it("handles empty and all-zero input without dividing by zero", () => {
    expect(projectSeats([])).toEqual([]);
    const zeros = projectSeats([{ partyId: "a", averageSeats: 0 }]);
    expect(zeros[0].seats).toBe(0);
  });
});

describe("seatsByBloc", () => {
  it("sums seats per bloc", () => {
    const projections = projectSeats([
      { partyId: "a", averageSeats: 40 },
      { partyId: "b", averageSeats: 40 },
      { partyId: "c", averageSeats: 40 },
    ]);
    const blocs = seatsByBloc(
      projections,
      new Map([
        ["a", "right"],
        ["b", "right"],
        ["c", "center-left"],
      ]),
    );
    expect(sum([...blocs.values()])).toBe(TOTAL_SEATS);
    expect(blocs.get("right")).toBe(80);
  });
});
