import { describe, expect, test } from "bun:test";

/**
 * The catalog's rules are written in src/catalog.ts and nowhere else
 * (README, "One catalog"): no public read states for itself which evenings
 * are published, ahead or over, ours or shared, how evenings are ordered,
 * or how an evening's lineup is. This reads the source of core and of the
 * Worker and fails on any file that does, unless it is listed below as
 * code that isn't a public read, with its reason.
 *
 * The list only shrinks. A listed file that no longer states a rule fails
 * too, so it comes off the list.
 */

/** Up to four sort terms before the one a rule looks for. */
const sortTerms = String.raw`ORDER BY\s+(?:[\w.]+(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?\s*,\s*){0,4}`;

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
  ["evenings' order", new RegExp(String.raw`${sortTerms}[a-z_.]*start_date\b`)],
  [
    "an evening's lineup",
    new RegExp(
      sortTerms +
        String.raw`(?:et\.position|ts\.created_at|es\.created_at|ep\.(?:role|position)|array_position\(\s*ARRAY\['organizer')`,
    ),
  ],
];

/** Where the rules are written. */
const catalog = "core/src/catalog.ts";

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

/** Reading the current time, rather than the instant every read is as of. */
const readsTheClock =
  /\bDateTime\.now\b|\bClock\.currentTimeMillis\b|\bnew Date\(\)|\bDate\.now\(\)/;

/** Where that instant is read (src/clock.ts's `asOf`). */
const clock = "core/src/clock.ts";

/**
 * Code that isn't a public read and reads the current time for its own
 * work: syncs, imports, reports, the organizers' tools, timings.
 */
const ownTime: Readonly<Record<string, string>> = {
  "core/src/collab/collab.ts": "collaborating on a draft, for the organizers",
  "core/src/completeness.ts": "the completeness report",
  "core/src/followers.ts": "the follower refresh",
  "core/src/ingest/ingest.ts": "image ingestion",
  "core/src/lineups.ts": "the lineups backfill, timing itself",
  "core/src/luma/descriptions.ts": "Luma import",
  "core/src/luma/drafts.ts": "Luma import of drafts",
  "core/src/luma/luma.ts": "the Luma client",
  "core/src/luma/people-sync.ts": "Luma import of people",
  "core/src/luma/publish.ts": "publishing, for the organizers",
  "core/src/luma/sync.ts": "the Luma sync",
  "core/src/luma/venues.ts": "Luma import of venues",
  "core/src/planning/planning.ts": "planning, for the organizers",
  "core/src/posts/candidates.ts": "the post search",
  "core/src/readiness/readiness.ts": "readiness, for the organizers",
  "core/src/slugs.ts": "gives evenings their links",
  "core/src/social/announce-discord.ts": "announcing on Discord",
  "core/src/social/announce-x.ts": "announcing on X",
  "core/src/social/announce.ts": "announcing",
  "core/src/social/sent-posts.ts": "recording what was posted",
  "web/src/images/route.ts": "timing image variants",
  "web/src/sync/run.ts": "the sync Worker",
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
    ["ORDER BY n.position, e.start_date, e.id", "evenings' order"],
    ["ORDER BY p.name, p.id, e.start_date DESC, e.id", "evenings' order"],
    [
      "ORDER BY et.position NULLS LAST, et.created_at, t.id",
      "an evening's lineup",
    ],
    ["json_agg(s.name ORDER BY es.created_at, s.id)", "an evening's lineup"],
    ["ORDER BY ep.position, ep.created_at, p.id", "an evening's lineup"],
    ["ORDER BY t.id, ts.created_at", "an evening's lineup"],
    ["ORDER BY s.name, es.created_at, s.id", "an evening's lineup"],
    ["ORDER BY e.id DESC NULLS LAST, et.position", "an evening's lineup"],
    ["ORDER BY ep.role, ep.position", "an evening's lineup"],
    [
      "ORDER BY array_position(ARRAY['organizer', 'co-host', 'mc'], ep.role)",
      "an evening's lineup",
    ],
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
      if (path === catalog || path in internal) continue;
      const names = await stated(path);
      if (names.length > 0) unlisted.push(`${path}: ${names.join(", ")}`);
    }
    expect(unlisted).toEqual([]);
  });

  test("every listed file still states one", async () => {
    const stale: Array<string> = [];
    for (const path of Object.keys(internal)) {
      if (!sources.includes(path) || (await stated(path)).length === 0) {
        stale.push(path);
      }
    }
    expect(stale).toEqual([]);
  });
});

describe("every public read is as of one instant", () => {
  test("no other file reads the current time unless it is listed", async () => {
    const unlisted: Array<string> = [];
    for (const path of sources) {
      if (path === clock || path in ownTime) continue;
      const text = await Bun.file(new URL(path, root)).text();
      if (readsTheClock.test(text)) unlisted.push(path);
    }
    expect(unlisted).toEqual([]);
  });

  test("every listed file still reads it", async () => {
    const stale: Array<string> = [];
    for (const path of Object.keys(ownTime)) {
      const text = sources.includes(path)
        ? await Bun.file(new URL(path, root)).text()
        : "";
      if (!readsTheClock.test(text)) stale.push(path);
    }
    expect(stale).toEqual([]);
  });
});
