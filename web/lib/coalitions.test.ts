import { describe, expect, it } from "vitest";
import { MAJORITY, coalitionSeats, completions } from "./coalitions";

const seats = { a: 40, b: 25, c: 30, d: 25 };
const names = (found: { members: string[] }[]) => found.map((c) => [...c.members].sort().join("+")).sort();

describe("coalitionSeats", () => {
  it("adds the members' seats and ignores unknown parties", () => {
    expect(coalitionSeats({ a: 30, b: 20 }, ["a", "b", "zzz"])).toBe(50);
  });
});

describe("completions", () => {
  it("uses a majority of 61", () => {
    expect(MAJORITY).toBe(61);
  });

  it("with nothing chosen, lists the minimal winning coalitions", () => {
    // a+b+c (95) wins but is not minimal: it still has 70 without b.
    expect(names(completions(seats))).toEqual(["a+b", "a+c", "a+d", "b+c+d"]);
  });

  it("adds only what an included party still needs", () => {
    // With a (40) in, any one of the others is enough.
    const found = completions(seats, ["a"]);
    expect(names(found)).toEqual(["b", "c", "d"]);
    expect(found.find((c) => c.members[0] === "c")!.seats).toBe(70);
  });

  it("never adds a party that was ruled out", () => {
    expect(names(completions(seats, [], ["a"]))).toEqual(["b+c+d"]);
  });

  it("lists the fewest additions first, then the slimmest majority", () => {
    const found = completions(seats);
    expect(found.map((c) => c.members.length)).toEqual([2, 2, 2, 3]);
    const pairs = found.slice(0, 3).map((c) => c.seats);
    expect(pairs).toEqual([...pairs].sort((x, y) => x - y));
  });

  it("returns nothing once the chosen parties already have a majority", () => {
    expect(completions(seats, ["a", "c"])).toEqual([]);
  });

  it("leaves out parties below the threshold", () => {
    expect(completions({ a: 61, out: 0 })).toEqual([{ members: ["a"], seats: 61 }]);
  });

  it("finds nothing when even everyone together falls short", () => {
    expect(completions({ a: 30, b: 20 })).toEqual([]);
  });
});
