import { describe, expect, test } from "bun:test";

/**
 * The catalog's rules are written in src/catalog.ts and nowhere else
 * (README, "One catalog"): no public read states for itself which evenings
 * are published, ahead or over, ours or shared, or how evenings are
 * ordered. This reads the source of core and of the Worker and fails on any
 * file that does, unless it is listed below with its reason.
 *
 * The lists only shrink. A listed file that no longer states a rule fails
 * too, so moving a file onto the catalog takes it off the list.
 */

/** What stating a rule looks like in SQL. */
const rules: ReadonlyArray<readonly [string, RegExp]> = [
  // Selecting by it, not reading it out: compared either way round, also
  // inside a function (`COALESCE(is_draft, false) = …`), negated, or bare
  // after WHERE and the like; never `SELECT e.is_draft AS …`.
  [
    "published or draft",
    new RegExp(
      [
        String.raw`\bis_draft\s*(?:=|<>|!=|\bIS\b)`,
        String.raw`(?:=|<>|!=)\s*(?:[a-z_]+\.)?is_draft\b`,
        String.raw`\(\s*(?:[a-z_]+\.)?is_draft\b[^()]*\)\s*(?:=|<>|!=|\bIS\b)`,
        String.raw`\b(?:WHERE|AND|OR|NOT|WHEN|ON)[\s(]+(?:[a-z_]+\.)?is_draft\b`,
      ].join("|"),
      "i",
    ),
  ],
  ["ahead or over", /\bend_date\s*(?:<=|>=|<|>)/],
  ["ours or shared", /\bcuration\s*=\s*'/],
  ["evenings' order", /ORDER BY\s+[a-z_.]*start_date\b/],
];

/** Where the rules are written. */
const catalog = "core/src/catalog.ts";

/**
 * Public reads that still state rules of their own, each until the change
 * that moves it onto the catalog.
 */
const notYetMoved: Readonly<Record<string, string>> = {
  "core/src/about.ts": "/about's numbers: a person's appearances",
  "core/src/evenings.ts": "/events: the shared selection",
  "core/src/event-page.ts": "the event page: its lineup and what's next",
  "core/src/home.ts": "home: the shared selection",
  "core/src/people-directory.ts": "/people: a person's appearances",
  "core/src/speakers.ts":
    "list_speakers: ended through the last instant, until that is settled",
  "web/src/seo/data.ts": "the feeds: the shared selection and appearances",
  "web/src/v1/data.ts":
    "/api/v1/speakers: ended through the last instant, until that is settled",
};

/**
 * Code that isn't a public read: it writes the catalog's columns, or
 * reads them to work on the data, and owns what it selects.
 */
const internal: Readonly<Record<string, string>> = {
  "core/src/completeness.ts": "the completeness report",
  "core/src/curation.ts": "writes curation from its backfill",
  "core/src/drafts.ts": "lists drafts for the organizers",
  "core/src/luma/descriptions.ts": "Luma import",
  "core/src/luma/drafts.ts": "Luma import of drafts",
  "core/src/luma/people-sync.ts": "Luma import of people",
  "core/src/luma/sync.ts": "the Luma sync, which writes is_draft",
  "core/src/luma/venues.ts": "Luma import of venues",
  "core/src/planning/planning.ts": "planning, for the organizers",
  "core/src/posts/candidates.ts": "the post search",
  "core/src/posts/review.ts": "post review, for the organizers",
  "core/src/programs.ts": "writes programs from their backfill",
  "core/src/readiness/readiness.ts": "readiness, for the organizers",
  "core/src/slugs.ts": "gives evenings their links",
  "core/src/sql.ts":
    "reads curation into JSON for the pages, and selects nothing by it",
  "core/src/talk-edits.ts": "edits talks, for the organizers",
};

const root = new URL("../../", import.meta.url);

const sources = [
  ...new Bun.Glob("core/src/**/*.ts").scanSync(root.pathname),
  ...new Bun.Glob("web/src/**/*.{ts,tsx}").scanSync(root.pathname),
].toSorted();

/** The rules `path` states, by name. */
async function stated(path: string): Promise<ReadonlyArray<string>> {
  const text = await Bun.file(new URL(path, root)).text();
  return rules.flatMap(([name, pattern]) => (pattern.test(text) ? [name] : []));
}

describe("what stating a rule looks like", () => {
  const states = (sql: string) =>
    rules.flatMap(([name, pattern]) => (pattern.test(sql) ? [name] : []));

  test.each([
    "WHERE e.is_draft = false",
    "WHERE is_draft = true",
    "AND NOT e.is_draft",
    "WHERE e.is_draft",
    "OR (is_draft AND x)",
    "WHERE ((e.is_draft))",
    "WHERE false = e.is_draft",
    "WHERE COALESCE(e.is_draft, false) = false",
    "CASE WHEN e.is_draft THEN 1 END",
    "e.is_draft IS NOT TRUE",
  ])("%s selects by published or draft", (sql) => {
    expect(states(sql)).toEqual(["published or draft"]);
  });

  test.each([
    'SELECT e.is_draft AS "isDraft"',
    "SELECT luma_event_id, is_draft FROM events",
    "is_draft: Schema.Boolean",
    "isDraft: row.is_draft,",
  ])("%s only reads it", (sql) => {
    expect(states(sql)).toEqual([]);
  });

  test.each([
    ["e.end_date >= now", "ahead or over"],
    ["e.end_date < $1", "ahead or over"],
    ["e.curation = 'ours'", "ours or shared"],
    ["ORDER BY e.start_date DESC, e.id", "evenings' order"],
  ])("%s states %s", (sql, name) => {
    expect(states(sql)).toEqual([name]);
  });
});

describe("the catalog's rules are stated once", () => {
  test("the catalog states each of them", async () => {
    // Its fragments name columns through a helper, so check the names.
    const text = await Bun.file(new URL(catalog, root)).text();
    for (const name of ["is_draft", "end_date", "curation", "start_date"]) {
      expect(text).toContain(`"${name}"`);
    }
  });

  test("no other file states one unless it is listed", async () => {
    const unlisted: Array<string> = [];
    for (const path of sources) {
      if (path === catalog || path in notYetMoved || path in internal) continue;
      const names = await stated(path);
      if (names.length > 0) unlisted.push(`${path}: ${names.join(", ")}`);
    }
    expect(unlisted).toEqual([]);
  });

  test("every listed file still states one", async () => {
    const stale: Array<string> = [];
    for (const path of [
      ...Object.keys(notYetMoved),
      ...Object.keys(internal),
    ]) {
      if (!sources.includes(path) || (await stated(path)).length === 0) {
        stale.push(path);
      }
    }
    expect(stale).toEqual([]);
  });
});
