import { describe, expect, test } from "bun:test";
import { distributeIntoColumns } from "../src/lib/masonry";

describe("masonry columns", () => {
  test("deals items round-robin so columns stay balanced and ordered", () => {
    expect(distributeIntoColumns([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 4, 7],
      [2, 5],
      [3, 6],
    ]);
  });

  test("keeps empty columns when there are fewer items than columns", () => {
    expect(distributeIntoColumns(["a"], 3)).toEqual([["a"], [], []]);
  });

  test("rejects column counts that cannot form a layout", () => {
    expect(() => distributeIntoColumns([1], 0)).toThrow(RangeError);
    expect(() => distributeIntoColumns([1], 1.5)).toThrow(RangeError);
  });
});
