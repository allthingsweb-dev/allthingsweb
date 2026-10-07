import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Exit, Layer } from "effect";
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
      }),
    ).toEqual([]);
  });
});
