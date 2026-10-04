import { describe, expect, test } from "bun:test";
import { contentEncoding } from "../src/pages/response.ts";

describe("content encoding", () => {
  test.each([
    [undefined, undefined],
    ["", undefined],
    ["identity", undefined],
    ["deflate", undefined],
    ["br, gzip", "br"],
    ["gzip, deflate, br;q=0.1", "br"],
    // A weight of 0 refuses the coding, however it is written.
    ["gzip, br;q=0", "gzip"],
    ["gzip, br;q=0.0", "gzip"],
    ["gzip, BR;Q=0", "gzip"],
    ["gzip;q=0.5, br; q=0.000", "gzip"],
    ["gzip;q=0, br;q=0", undefined],
    // A weight that isn't a number is ignored, as if absent.
    ["gzip;q=abc", "gzip"],
    // `*` covers every coding the header doesn't name.
    ["*", "br"],
    ["br;q=0, *", "gzip"],
    ["*;q=0", undefined],
  ] as const)("%p → %p", (header, expected) => {
    expect(contentEncoding(header)).toBe(expected);
  });
});
