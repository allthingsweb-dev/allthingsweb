import { describe, expect, test } from "bun:test";
import { CacheControl } from "../src/cache.ts";
import { withoutTrailingSlash } from "../src/trailing-slash.ts";

const at = (path: string) =>
  withoutTrailingSlash(`https://allthings.dev${path}`);

describe("withoutTrailingSlash", () => {
  test("sends a path with a trailing slash to the path without it, for good", () => {
    for (const [path, location] of [
      ["/lab/home/", "/lab/home"],
      ["/about/", "/about"],
      ["/events/?a=1&b=2", "/events?a=1&b=2"],
      ["/people/erik//", "/people/erik"],
      ["/lab/home/?", "/lab/home"],
    ] as const) {
      const response = at(path);
      expect([path, response?.status]).toEqual([path, 308]);
      expect(response?.headers.get("location")).toBe(location);
      expect(response?.headers.get("cache-control")).toBe(CacheControl.page);
    }
  });

  test("leaves every other path to the store and the app", () => {
    for (const path of ["/", "/?a=1", "/about", "/lab/home", "/x.php?a=/"]) {
      expect([path, at(path)]).toEqual([path, undefined]);
    }
  });

  test("never names another host", () => {
    for (const [path, location] of [
      ["//elsewhere.example/", "/elsewhere.example"],
      ["/\\elsewhere.example/", "/elsewhere.example"],
      ["//", "/"],
      ["///", "/"],
    ] as const) {
      expect([path, at(path)?.headers.get("location")]).toEqual([
        path,
        location,
      ]);
    }
  });
});
