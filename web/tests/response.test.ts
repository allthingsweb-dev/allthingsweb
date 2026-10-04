import { describe, expect, test } from "bun:test";
import { contentEncoding } from "../src/pages/response.ts";

describe("content encoding", () => {
  test.each([
    [undefined, "identity"],
    ["", "identity"],
    ["identity", "identity"],
    ["deflate", "identity"],
    ["br, gzip", "br"],
    ["gzip, deflate, br;q=0.1", "br"],
    // A weight of 0 refuses the coding, however it is written.
    ["gzip, br;q=0", "gzip"],
    ["gzip, br;q=0.0", "gzip"],
    ["gzip, BR;Q=0", "gzip"],
    ["gzip;q=0.5, br; q=0.000", "gzip"],
    ["gzip;q=0, br;q=0", "identity"],
    // A weight that isn't a number is ignored, as if absent.
    ["gzip;q=abc", "gzip"],
    // `*` covers every coding the header doesn't name.
    ["*", "br"],
    ["br;q=0, *", "gzip"],
    // Identity is refused only by name or by `*;q=0` without naming it.
    ["*;q=0", undefined],
    ["identity;q=0", undefined],
    ["IDENTITY;Q=0.0, gzip;q=0", undefined],
    ["*;q=0, identity", "identity"],
    ["*;q=0, gzip", "gzip"],
  ] as const)("%p → %p", (header, expected) => {
    expect(contentEncoding(header)).toBe(expected);
  });
});
