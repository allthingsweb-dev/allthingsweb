import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { publicVenue } from "../src/catalog.ts";
import { Evenings } from "../src/evenings.ts";
import { EventPages } from "../src/event-page.ts";
import { Events } from "../src/events.ts";
import { Home } from "../src/home.ts";
import { toEventSummary } from "../src/mappers.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Where an evening is, as public surfaces say it (catalog.ts,
 * `publicVenue`): while Luma shows its venue to approved guests only and
 * it is not over, only its city; once it is over, or while its venue is
 * public, the venue as stored. Read at the seed's clock,
 * 2026-10-03T19:00:00Z, by the fragment itself and through each of core's
 * public reads: the event page, home, /events and the MCP tools' rows.
 */

const db = await seededDatabase();
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, venue_guests_only, updated_at) VALUES
    -- Ahead, its venue shown to guests only, at a known venue (East Cut).
    ('e0000000-0000-4000-8000-000000000701', '2026-11-11-guests-only', 'Guests only', 'Soon', '2026-11-12T02:00:00Z', '2026-11-12T05:00:00Z', 200, '201 Spear St', '201 Spear St', '201 Spear St, San Francisco, CA 94105, USA', 'evt-guestsonly', false, false, true, now()),
    -- Over, its venue shown to guests only while it was ahead (FiDi).
    ('e0000000-0000-4000-8000-000000000702', '2026-09-09-was-guests-only', 'Was guests only', 'Before', '2026-09-10T01:00:00Z', '2026-09-10T04:00:00Z', 100, 'Sentry, 45 Fremont St, San Francisco, CA 94105, USA', 'Sentry', 'Sentry, 45 Fremont St, San Francisco, CA 94105, USA', 'evt-wasguestsonly', false, false, true, now()),
    -- Ahead, guests only, with an address that names no city.
    ('e0000000-0000-4000-8000-000000000703', '2026-11-20-no-city', 'No city', 'Later', '2026-11-21T02:00:00Z', '2026-11-21T05:00:00Z', 50, NULL, 'Park', 'Golden Gate Park', 'evt-nocity', false, false, true, now());
`);
afterAll(() => db.close());

const at = (iso: string) => DateTime.makeUnsafe(iso);

/** The three venue columns of `slug`, as the fragment gives them at `instant`, in both shapes. */
const venueAt = (slug: string, instant: DateTime.Utc = now) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const [row] = yield* sql<{
        columns: Record<string, string | null>;
        json: Record<string, string | null>;
      }>`
        SELECT
          (SELECT row_to_json(c) FROM (
            SELECT ${publicVenue(sql, "e", instant, "columns")}) c) AS columns,
          json_build_object(${publicVenue(sql, "e", instant, "json")}) AS json
        FROM events e WHERE e.slug = ${slug}`;
      if (row === undefined) throw new Error(`no ${slug}`);
      expect(row.json).toEqual(row.columns);
      return row.columns;
    }).pipe(Effect.provide(sqlLayer(db))),
  );

/** What the fragment gives an evening ahead and kept to guests, at `full` and `street`. */
const cityOf = (full: string | null, street: string | null = null) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const [row] = yield* sql<{ shortLocation: string | null }>`
        SELECT ${publicVenue(sql, "e", now, "columns")}
        FROM (SELECT ${full}::text AS full_address,
          ${street}::text AS street_address, 'A venue'::text AS short_location,
          true AS venue_guests_only,
          '2099-01-01T00:00:00Z'::timestamptz AS end_date) e`;
      return row?.shortLocation;
    }).pipe(Effect.provide(sqlLayer(db))),
  );

const stored = {
  streetAddress: "Sentry, 45 Fremont St, San Francisco, CA 94105, USA",
  shortLocation: "Sentry",
  fullAddress: "Sentry, 45 Fremont St, San Francisco, CA 94105, USA",
};

const cityOnly = {
  streetAddress: null,
  shortLocation: "San Francisco",
  fullAddress: null,
};

describe("publicVenue", () => {
  test("says only the city of an evening ahead that Luma keeps to guests", async () => {
    expect(await venueAt("2026-11-11-guests-only")).toEqual(cityOnly);
  });

  test("keeps it to the city while the evening is live, through its last instant, and shows it once it is over", async () => {
    for (const instant of [
      "2026-11-12T01:59:59.999Z",
      "2026-11-12T02:00:00.000Z",
      "2026-11-12T05:00:00.000Z",
    ]) {
      expect(await venueAt("2026-11-11-guests-only", at(instant))).toEqual(
        cityOnly,
      );
    }
    expect(
      await venueAt("2026-11-11-guests-only", at("2026-11-12T05:00:00.001Z")),
    ).toEqual({
      streetAddress: "201 Spear St",
      shortLocation: "201 Spear St",
      fullAddress: "201 Spear St, San Francisco, CA 94105, USA",
    });
  });

  test("shows the venue of an evening over, whatever Luma kept to guests", async () => {
    expect(await venueAt("2026-09-09-was-guests-only")).toEqual(stored);
  });

  test("leaves a public venue as stored, ahead or over", async () => {
    expect(await venueAt("2026-11-05-upcoming")).toEqual({
      streetAddress: null,
      shortLocation: "TBA",
      fullAddress: null,
    });
    expect(await venueAt("2026-08-12-react-at-acme")).toEqual({
      streetAddress: "1 Market St",
      shortLocation: "Acme HQ",
      fullAddress: "1 Market St, San Francisco, CA 94105",
    });
  });

  test("says nothing of a venue kept to guests whose address names no city", async () => {
    expect(await venueAt("2026-11-20-no-city")).toEqual({
      streetAddress: null,
      shortLocation: null,
      fullAddress: null,
    });
  });

  test.each([
    [
      "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
      "San Francisco",
    ],
    ["1 Market St, San Francisco, CA 94105", "San Francisco"],
    ["500 Coffee Ave, Oakland, CA", "Oakland"],
    ["San Francisco, CA, USA", "San Francisco"],
    [
      "Pier 70, 420 22nd St, San Francisco, CA 94107-1234, United States",
      "San Francisco",
    ],
    ["Golden Gate Park", null],
    ["", null],
  ])("finds the city of %p: %p", async (full, city) => {
    expect(await cityOf(full)).toBe(city);
  });

  test("takes the street address where there is no full one", async () => {
    expect(await cityOf(null, "201 Spear St, San Francisco, CA 94105")).toBe(
      "San Francisco",
    );
    expect(await cityOf("  ", "201 Spear St, San Francisco, CA 94105")).toBe(
      "San Francisco",
    );
  });
});

/** `effect` with core's public reads over the database, at `instant`. */
const read = <A, E>(
  effect: Effect.Effect<A, E, EventPages | Home | Evenings | Events>,
  instant: DateTime.Utc = now,
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        EventPages.layer,
        Home.layer,
        Evenings.layer,
        Events.layer,
      ).pipe(
        Layer.provideMerge(sqlLayer(db)),
        Layer.provideMerge(clockAt(instant)),
      ),
    ),
  );

const photoOrigin = "https://media.allthings.dev";

describe("each public read", () => {
  test("the event page names only the city: no venue, address, map or neighborhood", async () => {
    const page = await read(
      EventPages.use((pages) =>
        pages.read("2026-11-11-guests-only", photoOrigin),
      ),
    );
    expect(page.venue).toEqual({
      neighborhood: null,
      name: "San Francisco",
      address: null,
      mapQuery: null,
    });
    const none = await read(
      EventPages.use((pages) => pages.read("2026-11-20-no-city", photoOrigin)),
    );
    expect(none.venue).toBeNull();
  });

  test("the event page shows the whole venue once the evening is over", async () => {
    const over = await read(
      EventPages.use((pages) =>
        pages.read("2026-09-09-was-guests-only", photoOrigin),
      ),
    );
    expect(over.venue).toEqual({
      neighborhood: "FiDi",
      name: "Sentry",
      address: "45 Fremont St, San Francisco, CA 94105, USA",
      mapQuery: "Sentry, 45 Fremont St, San Francisco, CA 94105, USA",
    });
    const later = await read(
      EventPages.use((pages) =>
        pages.read("2026-11-11-guests-only", photoOrigin),
      ),
      at("2026-11-12T05:01:00Z"),
    );
    expect(later.venue).toEqual({
      neighborhood: "East Cut",
      name: null,
      address: "201 Spear St, San Francisco, CA 94105, USA",
      mapQuery: "201 Spear St, San Francisco, CA 94105, USA",
    });
  });

  test("home and /events name no neighborhood for it until it is over", async () => {
    const home = await read(Home.use((h) => h.read));
    const listed = [home.next, ...home.afterThat].filter(
      (evening) => evening?.slug === "2026-11-11-guests-only",
    );
    expect(listed.map((evening) => evening?.neighborhood)).toEqual([null]);
    const evenings = await read(Evenings.use((e) => e.read));
    const bySlug = new Map(
      [...evenings.ahead, ...evenings.past].map((evening) => [
        evening.slug,
        evening.neighborhood,
      ]),
    );
    expect(bySlug.get("2026-11-11-guests-only")).toBeNull();
    expect(bySlug.get("2026-09-09-was-guests-only")).toBe("FiDi");
    const later = await read(
      Evenings.use((e) => e.read),
      at("2026-11-12T05:01:00Z"),
    );
    expect(
      later.past.find((evening) => evening.slug === "2026-11-11-guests-only")
        ?.neighborhood,
    ).toBe("East Cut");
  });

  test("the MCP tools' rows, and so the CLI, have only the city as the venue", async () => {
    const origin = "https://allthings.dev";
    const rows = await read(Events.use((events) => events.listPublished));
    const summary = (slug: string) => {
      const row = rows.find((event) => event.slug === slug);
      if (row === undefined) throw new Error(`no ${slug}`);
      return toEventSummary(row, origin, now).venue;
    };
    expect(summary("2026-11-11-guests-only")).toEqual({
      name: "San Francisco",
      address: null,
    });
    expect(summary("2026-11-20-no-city")).toBeNull();
    expect(summary("2026-09-09-was-guests-only")).toEqual({
      name: "Sentry",
      address: "Sentry, 45 Fremont St, San Francisco, CA 94105, USA",
    });
    const details = await read(
      Events.use((events) => events.getPublished("2026-11-11-guests-only")),
    );
    expect(toEventSummary(details, origin, now).venue).toEqual({
      name: "San Francisco",
      address: null,
    });
  });
});
