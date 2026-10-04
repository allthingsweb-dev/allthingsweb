import { describe, expect, test } from "bun:test";
import { placeInColumns, type Placement } from "../src/lib/masonry";

const shownIn = (columns: Placement<string>[][], layout: number) =>
  columns.map((column) =>
    column
      .filter((placement) => placement.shownAt[layout])
      .map((placement) => placement.item),
  );

describe("masonry columns", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g"];
  const columns = placeInColumns(items, [2, 3]);

  test("deals every item round-robin, in order, under each column count", () => {
    expect(shownIn(columns, 0)).toEqual([
      ["a", "c", "e", "g"],
      ["b", "d", "f"],
      [],
    ]);
    expect(shownIn(columns, 1)).toEqual([
      ["a", "d", "g"],
      ["b", "e"],
      ["c", "f"],
    ]);
  });

  test("lists an item once per column, flagged for each layout", () => {
    expect(columns[0]).toEqual([
      { item: "a", index: 0, shownAt: [true, true] },
      { item: "c", index: 2, shownAt: [true, false] },
      { item: "d", index: 3, shownAt: [false, true] },
      { item: "e", index: 4, shownAt: [true, false] },
      { item: "g", index: 6, shownAt: [true, true] },
    ]);
  });

  test("keeps empty columns when there are fewer items than columns", () => {
    expect(shownIn(placeInColumns(["a"], [3]), 0)).toEqual([["a"], [], []]);
  });

  test("returns no columns without column counts", () => {
    expect(placeInColumns(items, [])).toEqual([]);
  });
});
