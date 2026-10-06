import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Exit, Layer, Option } from "effect";
import { LumaApi, type LumaEventVenue } from "../src/luma/api.ts";
import { Luma } from "../src/luma/luma.ts";
import { LumaSync } from "../src/luma/sync.ts";
import { formatVenues } from "../src/luma/venues-report.ts";
import {
  LumaVenues,
  type VenuesFill,
  type VenuesOptions,
} from "../src/luma/venues.ts";
import {
  clockAt,
  clockLayer,
  migratedDatabase,
  seededDatabase,
  sqlLayer,
} from "./support/database.ts";
import {
  configFrom,
  fakeLuma,
  fakeLumaBy,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

/**
 * Venues the calendar feed hides, from Luma's API: the client against
 * fixtures in the shape docs.luma.com documents, the fill against
 * tests/seed.sql, and the whole path for an event whose venue Luma shows to
 * guests only, as All Things Sync's was. No test reaches Luma.
 */

const managed = await fixture("event-manage.json");
const withKey = { LUMA_API_KEY: "test-key" };

/** Luma's answer for `id` at `address` (none for null), shown to `visibility`. */
const answer = (
  id: string,
  address: string | null,
  visibility = "guests-only",
): Reply => {
  const event = JSON.parse(managed) as Record<string, unknown>;
  return {
    body: JSON.stringify({
      ...event,
      id,
      geo_address_json:
        address === null
          ? null
          : { address: "CodeRabbit", full_address: address, description: null },
      location_visibility: visibility,
    }),
  };
};

/** A fake Luma answering by the event each request asks about. */
const fakeApi = (replies: Readonly<Record<string, ReadonlyArray<Reply>>>) =>
  fakeLumaBy((url) => url.searchParams.get("event_id") ?? "", replies);

const coderabbit =
  "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA";

describe("Luma's API", () => {
  const ask = (reply: Reply, env: Record<string, string> = withKey) => {
    const luma = fakeApi({ "evt-react": [reply] });
    return Effect.runPromiseExit(
      settle(
        LumaApi.use((api) =>
          Option.match(api.eventVenue, {
            onNone: () =>
              Effect.succeed<"no key" | Option.Option<LumaEventVenue>>(
                "no key",
              ),
            onSome: (eventVenue) => eventVenue("evt-react"),
          }),
        ),
      ).pipe(
        Effect.provide(
          LumaApi.layer.pipe(
            Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
  };

  test("reads where an event is, and whether only guests are shown", async () => {
    expect(await ask({ body: managed })).toEqual(
      Exit.succeed(
        Option.some({
          lumaEventId: "evt-react",
          location: "1 Market St, San Francisco, CA 94105",
          guestsOnly: false,
        }),
      ),
    );
    expect(await ask(answer("evt-react", ` ${coderabbit} `))).toEqual(
      Exit.succeed(
        Option.some({
          lumaEventId: "evt-react",
          location: coderabbit,
          guestsOnly: true,
        }),
      ),
    );
  });

  test("an event without a place has no location", async () => {
    for (const address of [null, "", "  "]) {
      expect(await ask(answer("evt-react", address, "public"))).toEqual(
        Exit.succeed(
          Option.some({
            lumaEventId: "evt-react",
            location: null,
            guestsOnly: false,
          }),
        ),
      );
    }
  });

  test("has nothing to ask without LUMA_API_KEY, nor about an event Luma hides", async () => {
    expect(await ask({ body: managed }, {})).toEqual(Exit.succeed("no key"));
    expect(await ask({ status: 403 })).toEqual(Exit.succeed(Option.none()));
  });
});

describe("the fill", () => {
  const opened: Array<PGlite> = [];
  afterAll(() => Promise.all(opened.map((db) => db.close())));

  /** tests/seed.sql, with the upcoming event's Luma id one Luma would send. */
  const database = async () => {
    const db = await seededDatabase();
    opened.push(db);
    await db.exec(
      `UPDATE events SET luma_event_id = 'evt-upcoming' WHERE id = 'e0000000-0000-4000-8000-000000000004'`,
    );
    return db;
  };

  const fill = async (
    db: PGlite,
    replies: Readonly<Record<string, ReadonlyArray<Reply>>> = {
      "evt-upcoming": [answer("evt-upcoming", coderabbit)],
    },
    options: Partial<VenuesOptions> & { env?: Record<string, string> } = {},
  ): Promise<{ result: VenuesFill; asked: ReadonlyArray<string | null> }> => {
    const { env = withKey, ...rest } = options;
    const luma = fakeApi(replies);
    const exit = await Effect.runPromiseExit(
      settle(
        LumaVenues.use((venues) => venues.run({ dryRun: false, ...rest })),
      ).pipe(
        Effect.provide(
          LumaVenues.layer.pipe(
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

  const venue = async (db: PGlite, slug = "2026-11-05-upcoming") =>
    (
      await db.query<{
        street_address: string | null;
        short_location: string | null;
        full_address: string | null;
        updated_at: Date;
      }>(
        "SELECT street_address, short_location, full_address, updated_at FROM events WHERE slug = $1",
        [slug],
      )
    ).rows[0];

  test("does nothing without LUMA_API_KEY", async () => {
    const db = await database();
    const { result, asked } = await fill(db, undefined, { env: {} });
    expect(result).toEqual({
      _tag: "Skipped",
      reason: "LUMA_API_KEY is not set",
    });
    expect(asked).toEqual([]);
  });

  test("asks only about published events without a venue, and fills theirs as the feed would", async () => {
    const db = await database();
    const { result, asked } = await fill(db);
    // React at Acme has a venue; the draft and events without a Luma page
    // are not asked about.
    expect(asked).toEqual(["evt-upcoming"]);
    expect(result).toMatchObject({
      _tag: "Planned",
      asked: 1,
      unplaced: [],
      unavailable: [],
      written: 1,
    });
    expect(await venue(db)).toEqual({
      street_address: coderabbit,
      // The organizers' "TBA" is theirs to change.
      short_location: "TBA",
      full_address: coderabbit,
      updated_at: new Date("2026-10-03T19:00:00Z"),
    });
    expect(formatVenues(result)).toBe(
      [
        "Asked Luma about 1 published event without a venue; 0 not shown to us.",
        "Filled 1 venue.",
        `  2026-11-05-upcoming: ${coderabbit} (shown to guests only on Luma)`,
      ].join("\n"),
    );
    // Then it has one, and nothing is asked again.
    expect((await fill(db)).asked).toEqual([]);
  });

  test("never fills a venue the organizers keep", async () => {
    const db = await database();
    await db.exec(
      `UPDATE events SET venue_by_organizer = true WHERE slug = '2026-11-05-upcoming'`,
    );
    const before = await venue(db);
    const { asked } = await fill(db);
    expect(asked).toEqual([]);
    expect(await venue(db)).toEqual(before);
  });

  test("takes Luma's placeholder for no venue, field by field", async () => {
    const db = await database();
    await db.exec(`UPDATE events SET
        street_address = 'https://luma.com/event/evt-upcoming',
        short_location = 'https://luma.com/event/evt-upcoming'
      WHERE luma_event_id = 'evt-upcoming'`);
    await fill(db);
    expect(await venue(db)).toMatchObject({
      street_address: coderabbit,
      short_location: "CodeRabbit",
      full_address: coderabbit,
    });
  });

  test("a dry run plans the same and writes nothing", async () => {
    const db = await database();
    const before = await venue(db);
    const { result } = await fill(db, undefined, { dryRun: true });
    expect(result).toMatchObject({ written: null, asked: 1 });
    expect(formatVenues(result)).toContain("Would fill 1 venue (dry run");
    expect(await venue(db)).toEqual(before);
  });

  test("lists the events Luma has no address for, or doesn't show us, and writes nothing for them", async () => {
    const db = await database();
    const before = await venue(db);
    const nowhere = await fill(db, {
      "evt-upcoming": [answer("evt-upcoming", null, "public")],
    });
    expect(nowhere.result).toMatchObject({
      unplaced: ["2026-11-05-upcoming"],
      written: 0,
    });
    expect(formatVenues(nowhere.result)).toContain(
      "Luma has no address for 1 event:\n  2026-11-05-upcoming",
    );
    const hidden = await fill(db, { "evt-upcoming": [{ status: 404 }] });
    expect(hidden.result).toMatchObject({
      unavailable: ["evt-upcoming"],
      written: 0,
    });
    expect(await venue(db)).toEqual(before);
  });

  test("a failure asking about any event writes nothing", async () => {
    const db = await database();
    await db.exec(
      `UPDATE events SET full_address = NULL, street_address = NULL WHERE luma_event_id = 'evt-react'`,
    );
    await expect(
      fill(db, {
        "evt-upcoming": [answer("evt-upcoming", coderabbit)],
        "evt-react": [{ status: 401 }],
      }),
    ).rejects.toThrow();
    expect((await venue(db))?.full_address).toBeNull();
  });
});

describe("an evening Luma shows the venue of to guests only", () => {
  test("is created without one from the feed, then gets it from the API", async () => {
    const db = await migratedDatabase();
    try {
      // How Luma's feed lists All Things Sync: its own page for a LOCATION.
      const feed = [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:evt-oZuT52GZDnYkAcL@events.lu.ma",
        "DTSTART:20260430T003000Z",
        "DTEND:20260430T033000Z",
        "SUMMARY:All Things Sync",
        "DESCRIPTION:Get up-to-date information at: https://luma.com/lu6m402p\\n\\nAddress:\\nCheck event page for more details.",
        "LOCATION:https://luma.com/event/evt-oZuT52GZDnYkAcL",
        "STATUS:TENTATIVE",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n");
      const at = clockAt(DateTime.makeUnsafe("2026-03-18T19:00:00Z"));
      await Effect.runPromise(
        settle(LumaSync.use((sync) => sync.run)).pipe(
          Effect.provide(
            LumaSync.layer.pipe(
              Layer.provide(
                Luma.layer.pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      fakeLuma([{ body: feed }]).layer,
                      configFrom(),
                    ),
                  ),
                ),
              ),
              Layer.provideMerge(sqlLayer(db)),
              Layer.provideMerge(at),
            ),
          ),
        ),
      );
      const stored = () =>
        db
          .query<{
            full_address: string | null;
            short_location: string | null;
          }>(
            "SELECT full_address, short_location FROM events WHERE luma_event_id = 'evt-oZuT52GZDnYkAcL'",
          )
          .then(({ rows }) => rows[0]);
      expect(await stored()).toEqual({
        full_address: null,
        short_location: null,
      });

      const luma = fakeApi({
        "evt-oZuT52GZDnYkAcL": [answer("evt-oZuT52GZDnYkAcL", coderabbit)],
      });
      await Effect.runPromise(
        settle(LumaVenues.use((venues) => venues.run({ dryRun: false }))).pipe(
          Effect.provide(
            LumaVenues.layer.pipe(
              Layer.provide(LumaApi.layer),
              Layer.provide(Layer.mergeAll(luma.layer, configFrom(withKey))),
              Layer.provideMerge(sqlLayer(db)),
              Layer.provideMerge(at),
            ),
          ),
        ),
      );
      expect(await stored()).toEqual({
        full_address: coderabbit,
        short_location: "CodeRabbit",
      });
    } finally {
      await db.close();
    }
  });
});
