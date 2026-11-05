import { describe, expect, test } from "bun:test";
import { formatJsonFile } from "../src/json-file.ts";

describe("formatJsonFile", () => {
  test("writes backfill/people.json exactly as it is", async () => {
    const text = await Bun.file(
      new URL("../backfill/people.json", import.meta.url),
    ).text();
    expect(formatJsonFile(JSON.parse(text))).toBe(text);
  });

  test("puts short arrays of plain values on one line, and the rest one value a line", () => {
    expect(
      formatJsonFile({
        short: ["a", "b"],
        long: ["x".repeat(40), "y".repeat(40)],
        none: [],
        empty: {},
      }),
    ).toBe(
      `{\n  "short": ["a", "b"],\n  "long": [\n    "${"x".repeat(40)}",\n    "${"y".repeat(40)}"\n  ],\n  "none": [],\n  "empty": {}\n}\n`,
    );
  });
});
