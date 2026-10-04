import { describe, expect, test } from "bun:test";
import { distributeIntoColumns } from "../src/lib/masonry";

describe("masonry columns", () => {
  test("deals items round-robin so columns stay balanced and ordered", () => {
    expect(
      distributeIntoColumns([1, 2, 3, 4, 5, 6, 7], ["a", "b", "c"]),
    ).toEqual([
      { column: "a", items: [1, 4, 7] },
      { column: "b", items: [2, 5] },
      { column: "c", items: [3, 6] },
    ]);
  });

  test("keeps empty columns when there are fewer items than columns", () => {
    expect(distributeIntoColumns(["x"], [1, 2, 3])).toEqual([
      { column: 1, items: ["x"] },
      { column: 2, items: [] },
      { column: 3, items: [] },
    ]);
  });

  test("returns no columns when there are none to fill", () => {
    expect(distributeIntoColumns([1, 2], [])).toEqual([]);
  });
});
