import { describe, expect, test } from "bun:test";
import * as Cookies from "effect/http/Cookies";
import {
  cookieValue,
  themeOf,
  themeOfHeader,
} from "../src/pages/theme-cookie.ts";

/**
 * The store reads a visitor's mode from the `Cookie` header itself
 * (page-store.ts), while the app reads it with Effect's parser: a page is
 * kept under a mode, so the two must read every header alike. Generated
 * headers, from pieces that reach each of the parser's turns (quotes, "%",
 * pairs without "=", repeated names, spaces), hold them together.
 */

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pieces = [
  "theme",
  " theme ",
  "them",
  "themes",
  "dark",
  "light",
  "system",
  '"',
  '"dark"',
  ";",
  "; ",
  "=",
  " ",
  "\t",
  "%",
  "%64ark",
  "%E0%A4%A",
  "a=b",
  "__proto__",
  "x",
] as const;

/** Effect's reading of `name` in `header`, as the app gets it. */
const effects = (header: string, name: string) => {
  const cookies = Cookies.parseHeader(header);
  return Object.hasOwn(cookies, name) ? cookies[name] : undefined;
};

describe("a cookie read from the header", () => {
  test("is Effect's reading, on every generated header", () => {
    const next = random(20_261_102);
    for (let index = 0; index < 20_000; index++) {
      const count = Math.floor(next() * 14);
      let header = "";
      for (let piece = 0; piece < count; piece++) {
        header += pieces[Math.floor(next() * pieces.length)];
      }
      expect([header, cookieValue(header, "theme")]).toEqual([
        header,
        effects(header, "theme"),
      ]);
      expect([header, themeOfHeader(header)]).toEqual([
        header,
        themeOf(Cookies.parseHeader(header)),
      ]);
    }
  });

  test.each([
    ["", undefined],
    ["theme=dark", "dark"],
    [" theme = light ; other=1", "light"],
    ["other=1; theme=dark; theme=light", "dark"],
    ['theme="dark"', "dark"],
    ["theme=%64ark", "dark"],
    ["theme=%E0%A4%A", "%E0%A4%A"],
    ["broken; theme=dark", "dark"],
    ["broken", undefined],
    ["themes=dark", undefined],
  ])("reads %j as %j", (header, value) => {
    expect(cookieValue(header, "theme")).toBe(value);
    expect(effects(header, "theme")).toBe(value);
  });
});
