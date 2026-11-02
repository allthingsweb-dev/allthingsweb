import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Schema } from "effect";
import { canonicalNow, isStale, lineParts, lineText, Now } from "../src/now.ts";
import { speakersWithoutNow, staleRecords } from "../src/now-refresh.ts";
import type { PeopleFile } from "../src/people-enrichment.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * What someone does now (src/now.ts): the record's rules, its line's
 * linked facts, and which records are due for another look
 * (src/now-refresh.ts), against tests/seed.sql, where Ada, Grace and Linus
 * spoke at evenings that have ended.
 */

const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const linus = "b0000000-0000-4000-8000-000000000003";

const record: Now = {
  line: "Ada [writes compilers at Acme](https://acme.example/team), and [spoke at at/react](https://acme.example/talk) in August.",
  links: [
    {
      title: "Compilers, gently",
      date: "2026-09-30",
      url: "https://ada.example/compilers",
      kind: "article",
    },
    {
      title: "A month of parsers",
      date: "2026-08",
      url: "https://ada.example/parsers",
      kind: "video",
    },
  ],
  checkedOn: "2026-10-02",
};

const decodes = (value: unknown) =>
  Exit.isSuccess(
    Schema.decodeUnknownExit(Now)(value, { onExcessProperty: "error" }),
  );

describe("lineParts", () => {
  test("splits a line into its words and its linked facts, in order", () => {
    expect(lineParts(record.line)).toEqual([
      { text: "Ada " },
      {
        text: "writes compilers at Acme",
        source: "https://acme.example/team",
      },
      { text: ", and " },
      { text: "spoke at at/react", source: "https://acme.example/talk" },
      { text: " in August." },
    ]);
    expect(lineText(record.line)).toBe(
      "Ada writes compilers at Acme, and spoke at at/react in August.",
    );
  });

  test("keeps a link's query string", () => {
    expect(
      lineParts("[A talk](https://www.youtube.com/watch?v=abc_123).").at(0),
    ).toEqual({
      text: "A talk",
      source: "https://www.youtube.com/watch?v=abc_123",
    });
  });
});

describe("Now", () => {
  test("takes a sourced, dated record", () => {
    expect(decodes(record)).toBe(true);
    expect(decodes({ ...record, links: [] })).toBe(true);
  });

  test.each([
    ["a line with no source", { line: "Ada writes compilers." }],
    [
      "a source that isn't https",
      { line: "Ada [writes compilers](http://acme.example)." },
    ],
    [
      "a bracket outside a link",
      { line: "Ada [writes compilers](https://acme.example) [at Acme]." },
    ],
    [
      "three sentences",
      {
        line: "Ada [writes compilers](https://acme.example). She likes them. A lot.",
      },
    ],
    [
      "a line without its full stop",
      { line: "Ada [writes compilers](https://acme.example)" },
    ],
    [
      "a line too long to read at a glance",
      {
        line: `Ada [writes compilers](https://acme.example)${" and more".repeat(40)}.`,
      },
    ],
    ["a February 30th", { checkedOn: "2026-02-30" }],
    ["five links", { links: Array.from({ length: 5 }, () => record.links[0]) }],
    ["links oldest first", { links: record.links.toReversed() }],
    [
      "a link dated after the record was checked",
      { links: [{ ...record.links[0]!, date: "2026-10-03" }] },
    ],
    [
      "a link of a kind it doesn't know",
      { links: [{ ...record.links[0]!, kind: "tweet" }] },
    ],
    ["a field it doesn't know", { summary: "Compilers." }],
  ])("refuses %s", (_, change) => {
    expect(decodes({ ...record, ...change })).toBe(false);
  });

  test("a month-only date sorts against a day of the same month either way", () => {
    expect(
      decodes({
        ...record,
        links: [
          { ...record.links[1]!, date: "2026-09" },
          { ...record.links[0]!, date: "2026-09-12" },
        ],
      }),
    ).toBe(true);
  });

  test("is stored with its keys in one order", () => {
    const shuffled = {
      checkedOn: record.checkedOn,
      links: record.links.map(({ kind, url, date, title }) => ({
        kind,
        url,
        date,
        title,
      })),
      line: record.line,
    };
    expect(canonicalNow(shuffled)).toBe(canonicalNow(record));
  });
});

describe("isStale", () => {
  test("counts whole days, the record's day included", () => {
    expect(isStale("2026-08-04", "2026-11-02", 90)).toBe(true);
    expect(isStale("2026-08-05", "2026-11-02", 90)).toBe(false);
    expect(isStale("2026-11-02", "2026-11-02", 0)).toBe(true);
  });
});

const file: PeopleFile = [
  { profileId: ada, name: "Ada Lovelace", now: record },
  {
    profileId: grace,
    name: "Grace Hopper",
    now: null,
    held: [
      {
        field: "now",
        value: "Grace leads the Navy's compilers.",
        sources: ["https://example.com/rumor"],
        reason: "a forum post only",
      },
    ],
  },
  {
    profileId: linus,
    name: "Linus",
    held: [
      {
        field: "now",
        value: "Linus moved to Portland.",
        sources: ["https://example.com/blog"],
        reason: "personal, and unsourced",
      },
    ],
  },
];

describe("staleRecords", () => {
  test("lists the records checked that many days ago or more, oldest first, never one taken down", () => {
    expect(staleRecords(file, "2026-10-12", 10)).toEqual([
      {
        profileId: ada,
        name: "Ada Lovelace",
        reason: "stale",
        now: record,
        held: [],
      },
    ]);
    expect(staleRecords(file, "2026-10-11", 10)).toEqual([]);
  });
});

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

describe("speakersWithoutNow", () => {
  test("lists who spoke at an evening that ended and was never looked at, with what was held", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const due = await Effect.runPromise(
      speakersWithoutNow(file).pipe(
        Effect.provide(sqlLayer(db)),
        Effect.provide(clockLayer),
      ),
    );
    expect(due).toEqual([
      {
        profileId: linus,
        name: "Linus",
        reason: "none",
        now: null,
        held: [
          {
            value: "Linus moved to Portland.",
            reason: "personal, and unsourced",
          },
        ],
      },
    ]);
  });
});
