import { describe, expect, test } from "bun:test";
import { DateTime, Effect, Schema } from "effect";
import * as TestClock from "effect/testing/TestClock";
import guideFile from "../backfill/guide.json" with { type: "json" };
import {
  type GuideEntry,
  GuideFile,
  guideAt,
  guideBoundaries,
  guideEntries,
  guideOn,
  readGuide,
  repeated,
} from "../src/guide.ts";

/**
 * The allthings guide (core/backfill/guide.json): the file itself, and the
 * guide as it is shown on a given day.
 */

const entry = (
  id: string,
  stars: 1 | 2 | 3,
  overrides: Partial<GuideEntry> = {},
): GuideEntry => ({
  id,
  name: id,
  stars,
  city: "Portland, Oregon",
  organizer: "Someone",
  url: `https://${id}.example.com/`,
  why: "Worth going.",
  sources: [`https://${id}.example.com/`],
  ...overrides,
});

describe("a guide file", () => {
  const decode = Schema.decodeUnknownExit(GuideFile);
  const ok = entry("chain-react", 3);

  test("takes an entry with or without its next edition's days", () => {
    expect(decode({ entries: [ok] })._tag).toBe("Success");
    expect(
      decode({
        entries: [{ ...ok, next: { from: "2027-04-29", to: "2027-04-30" } }],
      })._tag,
    ).toBe("Success");
  });

  test.each([
    ["no stars", { stars: 0 }],
    ["four stars", { stars: 4 }],
    ["an id that isn't lowercase words", { id: "Chain React" }],
    ["a why that isn't a sentence", { why: "worth going" }],
    ["a why of two lines", { why: "Worth going.\nReally." }],
    ["a why that trails off", { why: "Worth going..." }],
    ["a name with space around it", { name: " Chain React" }],
    ["a site that isn't https", { url: "http://chainreactconf.com/" }],
    ["no sources", { sources: [] }],
    [
      "a day not on the calendar",
      { next: { from: "2027-02-30", to: "2027-03-01" } },
    ],
    [
      "an edition that ends before it starts",
      { next: { from: "2027-04-30", to: "2027-04-29" } },
    ],
  ])("refuses %s", (_, change) => {
    expect(decode({ entries: [{ ...ok, ...change }] })._tag).toBe("Failure");
  });

  test("refuses an id or a name twice", () => {
    const other = entry("react-miami", 3);
    expect(decode({ entries: [ok, { ...other, id: ok.id }] })._tag).toBe(
      "Failure",
    );
    expect(decode({ entries: [ok, { ...other, name: ok.name }] })._tag).toBe(
      "Failure",
    );
    expect(repeated([ok, { ...other, name: ok.name }])).toEqual([ok.name]);
  });
});

describe("core/backfill/guide.json", () => {
  test("decodes, and names each happening once", () => {
    expect(Schema.decodeUnknownSync(GuideFile)(guideFile).entries).toEqual(
      guideEntries,
    );
    expect(repeated(guideEntries)).toEqual([]);
  });

  test("starts with the four Erik gave three stars", () => {
    expect(
      guideEntries.map(({ name, stars, city }) => ({ name, stars, city })),
    ).toEqual([
      { name: "Chain React", stars: 3, city: "Portland, Oregon" },
      { name: "React Miami", stars: 3, city: "Miami, Florida" },
      { name: "AI Engineer Miami", stars: 3, city: "Miami, Florida" },
      { name: "All Things Open", stars: 3, city: "Raleigh, North Carolina" },
    ]);
  });

  test("cites each happening's own site among its sources", () => {
    for (const { url, sources } of guideEntries) {
      const host = new URL(url).hostname;
      expect(sources.some((source) => new URL(source).hostname === host)).toBe(
        true,
      );
    }
  });
});

describe("the guide on a day", () => {
  const entries = [
    entry("zed-night", 1),
    entry("later", 3, { next: { from: "2027-10-17", to: "2027-10-19" } }),
    entry("undated", 3),
    entry("sooner", 3, { next: { from: "2027-04-26", to: "2027-04-27" } }),
    entry("detour", 2),
  ];

  test("shows three stars first, then two, then one, each under what it means", () => {
    expect(
      guideOn(entries, "2026-11-13").map(({ stars, meaning, advice }) => ({
        stars,
        meaning,
        advice,
      })),
    ).toEqual([
      {
        stars: 3,
        meaning: "worth a special journey",
        advice: "Plan a trip around it.",
      },
      {
        stars: 2,
        meaning: "worth a detour",
        advice: "Go out of your way when you're nearby.",
      },
      { stars: 1, meaning: "worth a stop", advice: "Go when you're in town." },
    ]);
  });

  test("leaves out a star count with nothing in it", () => {
    expect(
      guideOn([entry("a", 3), entry("b", 1)], "2026-11-13").map(
        (group) => group.stars,
      ),
    ).toEqual([3, 1]);
  });

  test("lists the dated first, soonest first, then the rest by name", () => {
    const [three] = guideOn(entries, "2026-11-13");
    expect(three?.entries.map((listed) => listed.id)).toEqual([
      "sooner",
      "later",
      "undated",
    ]);
  });

  test("shows an edition's days through its last day, then none until the next is written", () => {
    const days = (today: string) =>
      guideOn(entries, today)[0]?.entries.map((listed) => [
        listed.id,
        listed.next,
      ]);
    expect(days("2027-04-27")).toEqual([
      ["sooner", { from: "2027-04-26", to: "2027-04-27" }],
      ["later", { from: "2027-10-17", to: "2027-10-19" }],
      ["undated", null],
    ]);
    expect(days("2027-04-28")).toEqual([
      ["later", { from: "2027-10-17", to: "2027-10-19" }],
      ["sooner", null],
      ["undated", null],
    ]);
  });

  test("is dated in San Francisco", () => {
    // 11 PM on April 27 in San Francisco, already the 28th in UTC.
    const lateOnTheLastDay = DateTime.makeUnsafe("2027-04-28T06:00:00Z");
    const [three] = guideAt(lateOnTheLastDay);
    const aie = three?.entries.find(
      (listed) => listed.id === "ai-engineer-miami",
    );
    expect(aie?.next).toEqual({ from: "2027-04-26", to: "2027-04-27" });
  });

  test("is read as of the Clock", async () => {
    const groups = await Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2027-05-01T12:00:00Z"));
      return yield* readGuide;
    }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);
    const aie = groups[0]?.entries.find(
      (listed) => listed.id === "ai-engineer-miami",
    );
    expect(aie?.next).toBeNull();
  });
});

describe("when the guide changes on its own", () => {
  test("is the start of the San Francisco day after each written edition, in order", () => {
    expect(guideBoundaries).toEqual([
      // AI Engineer Miami ends April 27, 2027, in Pacific Daylight Time.
      Date.UTC(2027, 3, 28, 7),
      // React Miami ends April 30.
      Date.UTC(2027, 4, 1, 7),
      // All Things Open ends October 19.
      Date.UTC(2027, 9, 20, 7),
    ]);
  });

  test("is the instant an edition's days leave the guide", () => {
    const dated = (at: number) =>
      guideAt(DateTime.makeUnsafe(at))
        .flatMap((group) => group.entries)
        .filter((listed) => listed.next !== null).length;
    for (const boundary of guideBoundaries) {
      expect(dated(boundary)).toBe(dated(boundary - 60_000) - 1);
    }
  });
});
