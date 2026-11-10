import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Layer } from "effect";
import { LumaApi } from "../src/luma/api.ts";
import {
  LumaVenueVisibility,
  type VenueVisibility,
  type VenueVisibilityOptions,
} from "../src/luma/venue-visibility.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import {
  configFrom,
  fakeLumaBy,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

/**
 * Whether Luma shows each evening's venue to guests only, from Luma's API
 * (src/luma/venue-visibility.ts), against tests/seed.sql at its clock,
 * 2026-10-03T19:00:00Z, with Luma answering from fixtures in the shape
 * docs.luma.com documents. No test reaches Luma.
 */

const managed = await fixture("event-manage.json");
const withKey = { LUMA_API_KEY: "test-key" };

/** Luma's answer for `id`, its venue shown to `visibility`. */
const answer = (id: string, visibility = "guests-only"): Reply => {
  const event = JSON.parse(managed) as Record<string, unknown>;
  return {
    body: JSON.stringify({ ...event, id, location_visibility: visibility }),
  };
};

/** A fake Luma answering by the event each request asks about. */
const fakeApi = (replies: Readonly<Record<string, ReadonlyArray<Reply>>>) =>
  fakeLumaBy((url) => url.searchParams.get("event_id") ?? "", replies);

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

/**
 * tests/seed.sql, with Luma ids on the upcoming evening, which also gets a
 * venue, and on the one live at the clock, which ends at it.
 */
const database = async () => {
  const db = await seededDatabase();
  opened.push(db);
  await db.exec(`
    UPDATE events SET luma_event_id = 'evt-upcoming',
        street_address = '201 Spear St', short_location = '201 Spear St',
        full_address = '201 Spear St, San Francisco, CA 94105, USA',
        updated_at = '2026-01-01T00:00:00Z'
      WHERE id = 'e0000000-0000-4000-8000-000000000004';
    UPDATE events SET luma_event_id = 'evt-endsnow', updated_at = '2026-01-01T00:00:00Z'
      WHERE id = 'e0000000-0000-4000-8000-000000000005';
  `);
  return db;
};

const check = async (
  db: PGlite,
  replies: Readonly<Record<string, ReadonlyArray<Reply>>>,
  options: Partial<VenueVisibilityOptions> & {
    env?: Record<string, string>;
  } = {},
): Promise<{
  result: VenueVisibility;
  asked: ReadonlyArray<string | null>;
}> => {
  const { env = withKey, ...rest } = options;
  const luma = fakeApi(replies);
  const exit = await Effect.runPromiseExit(
    settle(
      LumaVenueVisibility.use((visibility) =>
        visibility.run({ dryRun: false, ...rest }),
      ),
    ).pipe(
      Effect.provide(
        LumaVenueVisibility.layer.pipe(
          Layer.provide(LumaApi.layer),
          Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  );
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return {
    result: exit.value,
    asked: luma.requests.map(({ url }) =>
      new URL(url).searchParams.get("event_id"),
    ),
  };
};

/** Each evening's setting and when its row last changed, by slug. */
const stored = async (db: PGlite) =>
  Object.fromEntries(
    (
      await db.query<{
        slug: string;
        venue_guests_only: boolean;
        updated_at: Date;
      }>("SELECT slug, venue_guests_only, updated_at FROM events ORDER BY slug")
    ).rows.map(({ slug, venue_guests_only, updated_at }) => [
      slug,
      { guestsOnly: venue_guests_only, updatedAt: updated_at.toISOString() },
    ]),
  );

const both = {
  "evt-upcoming": [answer("evt-upcoming")],
  "evt-endsnow": [answer("evt-endsnow", "public")],
};

describe("the venue visibility", () => {
  test("does nothing without LUMA_API_KEY", async () => {
    const db = await database();
    const before = await stored(db);
    const { result, asked } = await check(db, both, { env: {} });
    expect(result).toEqual({
      _tag: "Skipped",
      reason: "LUMA_API_KEY is not set",
    });
    expect(asked).toEqual([]);
    expect(await stored(db)).toEqual(before);
  });

  test("asks about every published evening not over with a Luma page, its venue stored or not, and marks the ones kept to guests", async () => {
    const db = await database();
    const before = await stored(db);
    const { result, asked } = await check(db, both);
    // Soonest first. React at Acme is over and the draft is a draft: neither
    // is asked about.
    expect(asked).toEqual(["evt-endsnow", "evt-upcoming"]);
    expect(result).toEqual({
      _tag: "Planned",
      asked: 2,
      guestsOnly: ["2026-11-05-upcoming"],
      changed: [
        {
          eventId: "e0000000-0000-4000-8000-000000000004",
          slug: "2026-11-05-upcoming",
          lumaEventId: "evt-upcoming",
          guestsOnly: true,
        },
      ],
      unavailable: [],
      written: 1,
    });
    expect(await stored(db)).toEqual({
      ...before,
      "2026-11-05-upcoming": {
        guestsOnly: true,
        updatedAt: "2026-10-03T19:00:00.000Z",
      },
    });
    // Asked again, Luma says the same: nothing changes.
    const again = await check(db, both);
    expect(again.result).toMatchObject({ changed: [], written: 0 });
  });

  test("clears the mark once Luma shows the venue to everyone", async () => {
    const db = await database();
    await db.exec(
      `UPDATE events SET venue_guests_only = true WHERE slug = '2026-11-05-upcoming'`,
    );
    const { result } = await check(db, {
      ...both,
      "evt-upcoming": [answer("evt-upcoming", "public")],
    });
    expect(result).toMatchObject({
      guestsOnly: [],
      changed: [{ slug: "2026-11-05-upcoming", guestsOnly: false }],
      written: 1,
    });
    expect((await stored(db))["2026-11-05-upcoming"]?.guestsOnly).toBe(false);
  });

  test("never asks about an evening over, which keeps what was last read", async () => {
    const db = await database();
    await db.exec(
      `UPDATE events SET venue_guests_only = true WHERE slug = '2026-08-12-react-at-acme'`,
    );
    const { asked } = await check(db, both);
    expect(asked).not.toContain("evt-react");
    expect((await stored(db))["2026-08-12-react-at-acme"]?.guestsOnly).toBe(
      true,
    );
  });

  test("asks about at most maxEvents, the soonest first", async () => {
    const db = await database();
    const { asked, result } = await check(db, both, { maxEvents: 1 });
    expect(asked).toEqual(["evt-endsnow"]);
    expect(result).toMatchObject({ asked: 1, changed: [], written: 0 });
  });

  test("a dry run plans the same and writes nothing", async () => {
    const db = await database();
    const before = await stored(db);
    const { result } = await check(db, both, { dryRun: true });
    expect(result).toMatchObject({
      asked: 2,
      changed: [{ slug: "2026-11-05-upcoming", guestsOnly: true }],
      written: null,
    });
    expect(await stored(db)).toEqual(before);
  });

  test("leaves an evening Luma doesn't show us as it is", async () => {
    const db = await database();
    const before = await stored(db);
    const { result } = await check(db, {
      ...both,
      "evt-upcoming": [{ status: 404 }],
    });
    expect(result).toMatchObject({
      unavailable: ["evt-upcoming"],
      changed: [],
      written: 0,
    });
    expect(await stored(db)).toEqual(before);
  });

  test("a failure asking about any evening writes nothing", async () => {
    const db = await database();
    const before = await stored(db);
    await expect(
      check(db, { ...both, "evt-endsnow": [{ status: 401 }] }),
    ).rejects.toThrow();
    expect(await stored(db)).toEqual(before);
  });
});
