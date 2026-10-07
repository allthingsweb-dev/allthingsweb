import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, DateTime, Effect, Exit, Layer, Option } from "effect";
import { LumaApi } from "../src/luma/api.ts";
import {
  draftChanges,
  formatDrafts,
  LumaDrafts,
  type StoredDraft,
} from "../src/luma/drafts.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
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

describe("the draft refresh", () => {
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

describe("a venue the organizers set meanwhile", () => {
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

describe("a draft's description", () => {
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
