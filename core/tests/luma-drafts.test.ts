import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, DateTime, Effect, Exit, Layer, Option } from "effect";
import { LumaApi } from "../src/luma/api.ts";
import {
  draftChanges,
  formatDrafts,
  formatForgotten,
  LumaDrafts,
  type StoredDraft,
} from "../src/luma/drafts.ts";
import {
  forgetBlocks,
  forgetDeletes,
} from "../migrations/0030_forget_draft.ts";
import {
  clockLayer,
  seededDatabase,
  sqlLayer,
  studioRun,
} from "./support/database.ts";
import {
  configFrom,
  fakeLumaBy,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

/**
 * The draft refresh (src/luma/drafts.ts) on tests/seed.sql, whose one
 * draft is evt-draft, with Luma's API faked from its documented answer
 * (fixtures/luma/event-manage.json, made private and renamed). Nothing
 * here reaches Luma.
 */

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

const manage = JSON.parse(await fixture("event-manage.json")) as Record<
  string,
  unknown
>;

/** Luma's answer for evt-draft: renamed, moved, at Standard Deviant, private. */
const answer = (overrides: Record<string, unknown> = {}): Reply => ({
  body: JSON.stringify({
    ...manage,
    id: "evt-draft",
    name: "Markdown Trivia Night",
    start_at: "2026-11-21T01:30:00.000Z",
    end_at: "2026-11-21T05:30:00.000Z",
    visibility: "private",
    geo_address_json: {
      full_address:
        "Standard Deviant Brewing Pier 70, 1070 Maryland St, San Francisco, CA 94107",
    },
    ...overrides,
  }),
});

const run = async (
  replies: ReadonlyArray<Reply>,
  dryRun: boolean,
  env: Record<string, string> = { LUMA_API_KEY: "test-key" },
) => {
  const luma = fakeLumaBy(() => "", { "": replies });
  const layer = LumaDrafts.layer.pipe(
    Layer.provide(
      LumaApi.layer.pipe(
        Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );
  const exit = await Effect.runPromiseExit(
    settle(LumaDrafts.use((drafts) => drafts.run({ dryRun }))).pipe(
      Effect.provide(layer),
    ),
  );
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return { result: exit.value, requests: luma.requests };
};

const stored = async () =>
  (
    await db.query<Record<string, unknown>>(
      `SELECT name, start_date::text AS start, end_date::text AS end, street_address, short_location, full_address, is_draft, updated_at::text AS updated
       FROM events WHERE luma_event_id = 'evt-draft'`,
    )
  ).rows[0];

// The refresh is the hourly sync's, as site_sync; only --add is the studio's.
describe.skipIf(studioRun)("the draft refresh", () => {
  test("asks Luma about each draft only, and plans its changes in a dry run", async () => {
    const before = await stored();
    const { result, requests } = await run([answer()], true);
    expect(requests.map((r) => r.url)).toEqual([
      "https://public-api.luma.com/v1/events/get?event_id=evt-draft",
    ]);
    expect(result).toEqual({
      _tag: "Planned",
      asked: 1,
      refreshed: [
        {
          eventId: "e0000000-0000-4000-8000-000000000002",
          slug: "2026-09-01-draft-night",
          lumaEventId: "evt-draft",
          changes: [
            {
              column: "name",
              before: "Draft night",
              after: "Markdown Trivia Night",
            },
            {
              column: "start_date",
              before: "2026-09-02T01:00:00.000Z",
              after: "2026-11-21T01:30:00.000Z",
            },
            {
              column: "end_date",
              before: "2026-09-02T04:00:00.000Z",
              after: "2026-11-21T05:30:00.000Z",
            },
            {
              column: "street_address",
              before: null,
              after:
                "Standard Deviant Brewing Pier 70, 1070 Maryland St, San Francisco, CA 94107",
            },
            {
              column: "short_location",
              before: "Secret",
              after: "Standard Deviant Brewing Pier 70",
            },
            {
              column: "full_address",
              before: null,
              after:
                "Standard Deviant Brewing Pier 70, 1070 Maryland St, San Francisco, CA 94107",
            },
            // Its description, as the import of published ones stores it.
            {
              column: "luma_description",
              before: null,
              after: "<p>Server components in practice.</p>\n",
            },
          ],
        },
      ],
      public: [],
      unavailable: [],
      written: null,
    });
    expect(await stored()).toEqual(before);
    expect(formatDrafts(result)).toContain(
      "name: Draft night → Markdown Trivia Night",
    );
  });

  test("writes it, still a draft, and then has nothing to change", async () => {
    const { result } = await run([answer()], false);
    expect(result).toMatchObject({ written: 1 });
    const [description] = (
      await db.query<{ html: string | null; summary: string | null }>(
        "SELECT luma_description AS html, luma_summary AS summary FROM events WHERE luma_event_id = 'evt-draft'",
      )
    ).rows;
    // Too short a sentence for a summary, as in the import of published ones.
    expect(description).toEqual({
      html: "<p>Server components in practice.</p>\n",
      summary: null,
    });
    expect(await stored()).toMatchObject({
      name: "Markdown Trivia Night",
      start: "2026-11-21 01:30:00+00",
      short_location: "Standard Deviant Brewing Pier 70",
      is_draft: true,
      updated: "2026-10-03 19:00:00+00",
    });
    const again = await run([answer()], false);
    expect(again.result).toMatchObject({ refreshed: [], written: 0 });
  });

  test("keeps a venue the organizers set", async () => {
    await db.exec(
      `UPDATE events SET venue_by_organizer = true, street_address = '1 Market St' WHERE luma_event_id = 'evt-draft'`,
    );
    const { result } = await run([answer()], false);
    if (result._tag !== "Planned") throw new Error("skipped");
    expect(result.refreshed[0]?.changes.map((c) => c.column)).toEqual([
      "name",
      "start_date",
      "end_date",
      "luma_description",
    ]);
    expect(await stored()).toMatchObject({ street_address: "1 Market St" });
  });

  test("leaves publishing to the feed, and an event Luma no longer shows as it is", async () => {
    const shown = await run([answer({ visibility: "public" })], true);
    expect(shown.result).toMatchObject({ public: ["2026-09-01-draft-night"] });
    const gone = await run([{ status: 404 }], false);
    expect(gone.result).toMatchObject({
      refreshed: [],
      unavailable: ["evt-draft"],
      written: 0,
    });
  });

  test("does nothing without LUMA_API_KEY", async () => {
    const { result, requests } = await run([], false, {});
    expect(result).toEqual({
      _tag: "Skipped",
      reason: "LUMA_API_KEY is not set",
    });
    expect(requests).toEqual([]);
  });
});

describe("draftChanges", () => {
  const draft: StoredDraft = {
    eventId: "e",
    slug: "s",
    lumaEventId: "evt-x",
    name: "Same",
    startDate: DateTime.makeUnsafe("2026-11-21T01:30:00Z"),
    endDate: DateTime.makeUnsafe("2026-11-21T05:30:00Z"),
    venueByOrganizer: false,
    streetAddress: "1 Market St",
    shortLocation: "1 Market St",
    fullAddress: "1 Market St",
    lumaDescription: null,
    lumaSummary: null,
  };

  test("is empty when Luma says what is stored, and keeps what Luma doesn't say", () => {
    expect(
      draftChanges(draft, {
        lumaEventId: "evt-x",
        name: "Same",
        startDate: draft.startDate,
        endDate: null,
        visibility: "private",
        location: null,
        description: null,
      }),
    ).toEqual([]);
  });
});

describe.skipIf(studioRun)("a venue the organizers set meanwhile", () => {
  test("stays theirs, while the rest of the refresh is written", async () => {
    // Luma answers while an organizer sets the venue: after the refresh
    // read the draft, before it writes.
    const api = Layer.succeed(
      LumaApi,
      LumaApi.of({
        eventPeople: Option.none(),
        eventVenue: Option.none(),
        eventDescription: Option.none(),
        eventDetails: Option.some((lumaEventId: string) =>
          Effect.promise(() =>
            db.exec(
              `UPDATE events SET venue_by_organizer = true, street_address = '1 Market St', full_address = '1 Market St, San Francisco' WHERE luma_event_id = '${lumaEventId}'`,
            ),
          ).pipe(
            Effect.as(
              Option.some({
                lumaEventId,
                name: "Markdown Trivia Night",
                startDate: DateTime.makeUnsafe("2026-11-21T01:30:00Z"),
                endDate: null,
                visibility: "private" as const,
                location: "Standard Deviant Brewing Pier 70, 1070 Maryland St",
                description: null,
              }),
            ),
          ),
        ),
      }),
    );
    const result = await Effect.runPromise(
      LumaDrafts.use((drafts) => drafts.run({ dryRun: false })).pipe(
        Effect.provide(
          LumaDrafts.layer.pipe(
            Layer.provide(api),
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    expect(result).toMatchObject({ written: 1 });
    expect(await stored()).toMatchObject({
      name: "Markdown Trivia Night",
      street_address: "1 Market St",
      short_location: "Secret",
      full_address: "1 Market St, San Francisco",
    });
  });
});

describe("adding a private event as a draft", () => {
  /** Luma's answer for a new private evening the studio made. */
  const fresh = (overrides: Record<string, unknown> = {}) =>
    answer({
      id: "evt-new",
      name: "allthings/trivia",
      start_at: "2026-10-28T01:00:00.000Z",
      end_at: "2026-10-28T04:30:00.000Z",
      geo_address_json: {
        full_address: "CodeRabbit, 201 Spear St, San Francisco, CA 94105",
      },
      ...overrides,
    });

  const add = async (
    replies: ReadonlyArray<Reply>,
    dryRun: boolean,
    lumaEventId = "evt-new",
    env: Record<string, string> = { LUMA_API_KEY: "test-key" },
  ) => {
    const luma = fakeLumaBy(() => "", { "": replies });
    const layer = LumaDrafts.layer.pipe(
      Layer.provide(
        LumaApi.layer.pipe(
          Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
        ),
      ),
      Layer.provideMerge(sqlLayer(db)),
      Layer.provideMerge(clockLayer),
    );
    const exit = await Effect.runPromiseExit(
      settle(
        LumaDrafts.use((drafts) => drafts.add(lumaEventId, { dryRun })),
      ).pipe(Effect.provide(layer)),
    );
    return { exit, requests: luma.requests };
  };

  const row = async () =>
    (
      await db.query<Record<string, unknown>>(
        `SELECT slug, name, start_date::text AS start, end_date::text AS end, is_draft, tagline, short_location, full_address, luma_description
         FROM events WHERE luma_event_id = 'evt-new'`,
      )
    ).rows[0];

  const reason = (exit: Exit.Exit<unknown, unknown>) => {
    if (Exit.isSuccess(exit)) throw new Error("expected a refusal");
    return String(Cause.squash(exit.cause));
  };

  test("a dry run asks Luma once and writes nothing", async () => {
    const { exit, requests } = await add([fresh()], true);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value).toEqual({
      lumaEventId: "evt-new",
      slug: "2026-10-27-allthings-trivia-evt-new",
      name: "allthings/trivia",
      startDate: "2026-10-28T01:00:00.000Z",
      endDate: "2026-10-28T04:30:00.000Z",
      venue: "CodeRabbit",
      written: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/v1/events/get");
    expect(await row()).toBeUndefined();
  });

  test("stores it as the sync would, as a draft", async () => {
    const { exit } = await add([fresh()], false);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value.written).toBe(true);
    expect(await row()).toEqual({
      slug: "2026-10-27-allthings-trivia-evt-new",
      name: "allthings/trivia",
      start: "2026-10-28 01:00:00+00",
      end: "2026-10-28 04:30:00+00",
      is_draft: true,
      tagline: "See Luma for event details and registration.",
      short_location: "CodeRabbit",
      full_address: "CodeRabbit, 201 Spear St, San Francisco, CA 94105",
      luma_description: "<p>Server components in practice.</p>\n",
    });
    // The refresh knows it from then on.
    const { result } = await run([answer(), fresh()], true);
    expect(result).toMatchObject({ asked: 2 });
  });

  test("refuses a public event, one already stored, one Luma doesn't show, and no key", async () => {
    expect(
      reason((await add([fresh({ visibility: "public" })], false)).exit),
    ).toContain(
      "allthings/trivia is public on Luma: the calendar feed brings it in.",
    );
    expect(reason((await add([answer()], false, "evt-draft")).exit)).toContain(
      "Markdown Trivia Night is already stored, as 2026-09-01-draft-night.",
    );
    expect(reason((await add([{ status: 404 }], false)).exit)).toContain(
      "Luma doesn't show us evt-new",
    );
    await db.exec(
      "UPDATE events SET slug = '2026-10-27-allthings-trivia-evt-new' WHERE luma_event_id = 'evt-draft'",
    );
    for (const dryRun of [true, false]) {
      expect(reason((await add([fresh()], dryRun)).exit)).toContain(
        "Another evening has the slug 2026-10-27-allthings-trivia-evt-new: nothing was written.",
      );
    }
    const keyless = await add([fresh()], false, "evt-new", {});
    expect(reason(keyless.exit)).toContain("LUMA_API_KEY is not set");
    expect(keyless.requests).toEqual([]);
    expect(await row()).toBeUndefined();
  });
});

describe.skipIf(studioRun)("a draft's description", () => {
  const description = async () =>
    (
      await db.query<{ html: string | null; summary: string | null }>(
        "SELECT luma_description AS html, luma_summary AS summary FROM events WHERE luma_event_id = 'evt-draft'",
      )
    ).rows[0];

  test("follows Luma: an edited one replaces it, a removed one empties it and its summary", async () => {
    await run(
      [
        answer({
          description_md:
            "**How it works**\n\nTeams of up to four, and a wager round at the end.",
        }),
      ],
      false,
    );
    expect(await description()).toEqual({
      html: "<p><strong>How it works</strong></p>\n<p>Teams of up to four, and a wager round at the end.</p>\n",
      summary: "Teams of up to four, and a wager round at the end.",
    });
    await run([answer({ description_md: "" })], false);
    expect(await description()).toEqual({ html: "", summary: null });
  });
});

describe("forgetting a draft whose Luma event is gone", () => {
  const gone = "e0000000-0000-4000-8000-0000000000aa";
  const slug = "2026-11-09-allthings-aie-evt-gone";

  /** A draft Luma deleted, with a private lineup, a talk and a note. */
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, luma_event_id, is_draft, updated_at)
        VALUES ('${gone}', '${slug}', 'allthings/aie', 'See Luma.', '2026-11-10T02:00:00Z', '2026-11-10T05:00:00Z', 0, 'evt-gone', true, now());
      INSERT INTO planning.draft_people (event_id, profile_id, role, position) VALUES
        ('${gone}', 'b0000000-0000-4000-8000-000000000001', 'organizer', 0),
        ('${gone}', 'b0000000-0000-4000-8000-000000000002', 'mc', 0);
      INSERT INTO planning.wanted_speakers (id, profile_id) VALUES
        ('70000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003');
      INSERT INTO planning.draft_talks (id, event_id, position, kind, title) VALUES
        ('71000000-0000-4000-8000-000000000001', '${gone}', 1, 'talk', 'Made-up talk');
      INSERT INTO planning.draft_talk_people (draft_talk_id, wanted_speaker_id, role, position) VALUES
        ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'speaker', 0);
      INSERT INTO planning.draft_notes (event_id, actor, kind, text) VALUES
        ('${gone}', 'erik', 'decision', 'Moved to the 11th.');
    `);
  });

  const forget = async (
    replies: ReadonlyArray<Reply>,
    dryRun: boolean,
    draft = slug,
    env: Record<string, string> = {
      LUMA_API_KEY: "test-key",
      ALLTHINGS_ACTOR: "test/core",
    },
  ) => {
    const luma = fakeLumaBy(() => "", { "": replies });
    const layer = LumaDrafts.layer.pipe(
      Layer.provide(
        LumaApi.layer.pipe(
          Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
        ),
      ),
      Layer.provideMerge(sqlLayer(db)),
      Layer.provideMerge(clockLayer),
    );
    const exit = await Effect.runPromiseExit(
      settle(LumaDrafts.use((drafts) => drafts.forget(draft, { dryRun }))).pipe(
        Effect.provide(layer),
        Effect.provide(configFrom(env)),
      ),
    );
    return { exit, requests: luma.requests };
  };

  const reason = (exit: Exit.Exit<unknown, unknown>) => {
    if (Exit.isSuccess(exit)) throw new Error("expected a refusal");
    return String(Cause.squash(exit.cause));
  };

  /** What forgetting touches: the evening, its lineup, talks, log and notes. */
  const left = async () =>
    (
      await db.query<Record<string, number>>(
        `SELECT (SELECT count(*) FROM events WHERE id = '${gone}')::int AS events,
           (SELECT count(*) FROM planning.draft_people WHERE event_id = '${gone}')::int AS people,
           (SELECT count(*) FROM planning.draft_talks WHERE event_id = '${gone}')::int AS talks,
           (SELECT count(*) FROM planning.draft_talk_people)::int AS talk_people,
           (SELECT count(*) FROM planning.wanted_speakers)::int AS wanted,
           (SELECT count(*) FROM planning.draft_log WHERE event_id = '${gone}')::int AS log,
           (SELECT count(*) FROM planning.draft_notes WHERE event_id = '${gone}')::int AS notes`,
      )
    ).rows[0];

  const before = {
    events: 1,
    people: 2,
    talks: 1,
    talk_people: 1,
    wanted: 1,
    log: 0,
    notes: 1,
  };

  test("a dry run asks Luma once, says what it would delete and keep, and writes nothing", async () => {
    const { exit, requests } = await forget([{ status: 404 }], true);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value).toEqual({
      slug,
      lumaEventId: "evt-gone",
      name: "allthings/aie",
      deletes: {
        "planning.draft_talk_people": 1,
        "planning.draft_talks": 1,
        "planning.draft_people": 2,
        "public.events": 1,
      },
      keeps: {
        "planning.collab_audit": 0,
        "planning.draft_log": 0,
        "planning.draft_notes": 1,
      },
      written: false,
    });
    expect(requests.map((r) => r.url)).toEqual([
      "https://public-api.luma.com/v1/events/get?event_id=evt-gone",
    ]);
    expect(await left()).toEqual(before);
    expect(formatForgotten(exit.value)).toBe(
      [
        `Would forget (dry run: nothing written) the draft ${slug} (allthings/aie): Luma no longer has evt-gone.`,
        "  would delete: planning.draft_people 2, planning.draft_talk_people 1, planning.draft_talks 1, public.events 1",
        "  would keep, with no foreign key to it: planning.draft_notes 1",
      ].join("\n"),
    );
  });

  test("forgets it with its lineup and talks, in its log, and keeps its notes", async () => {
    // By its Luma id too, as the refresh names it; Luma's 403 is gone as well.
    const { exit } = await forget([{ status: 403 }], false, "evt-gone");
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value).toMatchObject({ slug, written: true });
    expect(await left()).toEqual({
      events: 0,
      people: 0,
      talks: 0,
      talk_people: 0,
      wanted: 1,
      log: 1,
      notes: 1,
    });
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT actor, command, summary, payload FROM planning.draft_log WHERE event_id = '${gone}'`,
    );
    expect(rows).toEqual([
      {
        actor: "test/core",
        command: "luma:drafts --forget",
        summary: `Forgot the draft ${slug}: Luma no longer has evt-gone.`,
        payload: {
          lumaEventId: "evt-gone",
          slug,
          deletes: {
            "planning.draft_talk_people": 1,
            "planning.draft_talks": 1,
            "planning.draft_people": 2,
            "public.events": 1,
          },
        },
      },
    ]);
    // Gone: there is nothing left to forget.
    expect(reason((await forget([{ status: 404 }], false)).exit)).toContain(
      `No evening is stored as ${slug}.`,
    );
  });

  test("refuses while Luma has it, and without a key or an actor", async () => {
    expect(
      reason((await forget([answer({ id: "evt-gone" })], false)).exit),
    ).toContain("Luma still has evt-gone");
    const keyless = await forget([], false, slug, {
      ALLTHINGS_ACTOR: "test/core",
    });
    expect(reason(keyless.exit)).toContain("LUMA_API_KEY is not set");
    expect(keyless.requests).toEqual([]);
    expect(
      reason(
        (
          await forget([{ status: 404 }], false, slug, {
            LUMA_API_KEY: "test-key",
          })
        ).exit,
      ),
    ).toContain("set ALLTHINGS_ACTOR");
    expect(await left()).toEqual(before);
  });

  test("refuses a published evening, one without a Luma event, and one something public points at", async () => {
    expect(
      reason((await forget([], false, "2026-08-12-react-at-acme")).exit),
    ).toContain(
      "2026-08-12-react-at-acme is published: only a draft is forgotten.",
    );
    await db.exec(
      `UPDATE events SET luma_event_id = NULL WHERE id = '${gone}'`,
    );
    expect(reason((await forget([], false)).exit)).toContain(
      "has no Luma event, so Luma can't confirm it is gone",
    );
    // The seed's draft has a public talk, and an idea is its.
    await db.exec(`
      INSERT INTO planning.ideas (title, pitch, program, event_id) VALUES ('Made up', 'Made up.', 'talks', 'e0000000-0000-4000-8000-000000000002')`);
    for (const dryRun of [true, false]) {
      expect(
        reason((await forget([{ status: 404 }], dryRun, "evt-draft")).exit),
      ).toBe(
        "DraftNotForgotten: 2026-09-01-draft-night is kept by planning.ideas (1), public.event_talks (1): nothing was written.",
      );
    }
    expect(
      (await db.query(`SELECT 1 FROM events WHERE luma_event_id = 'evt-draft'`))
        .rows,
    ).toHaveLength(1);
  });

  test("planning.forget_draft deletes nothing something keeps, even asked to", async () => {
    const { rows } = await db.query<{ answer: unknown }>(
      `SELECT planning.forget_draft('e0000000-0000-4000-8000-000000000002', true) AS answer`,
    );
    expect(rows[0]?.answer).toMatchObject({
      blocks: { "public.event_talks": 1 },
      forgotten: false,
    });
    const published = await db.query<{ answer: unknown }>(
      `SELECT planning.forget_draft('e0000000-0000-4000-8000-000000000001', true) AS answer`,
    );
    expect(published.rows[0]?.answer).toMatchObject({
      blocks: { "public.events.is_draft": 1 },
      forgotten: false,
    });
    const missing = await db.query<{ answer: unknown }>(
      `SELECT planning.forget_draft(gen_random_uuid(), true) AS answer`,
    );
    expect(missing.rows[0]?.answer).toBeNull();
  });

  test("planning.forget_draft names every foreign key to an evening or a draft talk", async () => {
    const { rows } = await db.query<{ key: string }>(
      `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS key
       FROM pg_catalog.pg_constraint k
       JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       WHERE k.contype = 'f'
         AND k.confrelid IN ('public.events'::regclass, 'planning.draft_talks'::regclass)
       ORDER BY 1`,
    );
    const named = [
      ...forgetBlocks.map(([table, column]) => `${table}.${column}`),
      "planning.draft_people.event_id",
      "planning.draft_talks.event_id",
      "planning.draft_talk_people.draft_talk_id",
    ];
    const keys = [...new Set(rows.map((row) => row.key))];
    expect(named).toEqual(expect.arrayContaining(keys));
    // Held to the evening through a collaborator or a round, and counted
    // by its own event_id too.
    expect(named.filter((key) => !keys.includes(key)).toSorted()).toEqual([
      "planning.logistics_confirmations.event_id",
      "planning.round_submissions.event_id",
    ]);
    expect(forgetDeletes).toEqual([
      "planning.draft_talk_people",
      "planning.draft_talks",
      "planning.draft_people",
      "public.events",
    ]);
  });
});

describe("the refresh, for an event Luma no longer shows", () => {
  test("names the command that forgets its draft", () => {
    expect(
      formatDrafts({
        _tag: "Planned",
        asked: 2,
        refreshed: [],
        public: [],
        unavailable: ["evt-gone"],
        written: 0,
      }),
    ).toBe(
      [
        "Asked Luma about 2 drafts; 1 not shown to us: evt-gone.",
        "Refreshed 0 drafts.",
        "  If Luma deleted evt-gone, forget its draft: bun run luma:drafts --forget evt-gone --dry-run",
      ].join("\n"),
    );
  });
});
