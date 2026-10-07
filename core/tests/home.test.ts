import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import { DataSourceError } from "../src/errors.ts";
import { afterThatLimit, Home, type HomeView } from "../src/home.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Home against the migrated production schema: tests/seed.sql plus a few
 * photos and one more evening, so photo selection and the limits show.
 */

const db = await seededDatabase();
await db.exec(`
  INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
    ('d0000000-0000-4000-8000-000000000101', 'https://elsewhere.example/cafe-first.jpg', '', 'Elsewhere', 800, 600, now()),
    ('d0000000-0000-4000-8000-000000000102', 'https://storage.example/photos/cafe.jpg', '', 'Coffee at Café night', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000103', 'https://storage.example/photos/cafe-later.jpg', '', 'Later at Café night', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000104', 'https://storage.example/photos/draft.jpg', '', 'A draft', 1200, 800, now()),
    ('d0000000-0000-4000-8000-000000000105', 'https://storage.example/photos/soon.jpg', '', 'Not yet', 1200, 800, now());
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, preview_image, recording_url, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000107', '2026-12-01-all-things-effect', 'All Things Effect 🎉', 'Typed', '2026-12-02T01:30:00Z', '2026-12-02T04:30:00Z', 100, 'CodeRabbit, 201 Spear St 12th floor', 'CodeRabbit', NULL, 'evt-effect', false, false, NULL, NULL, now());
  -- Café night's first photo is on another origin, so its next one stands in.
  INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000103', '2026-01-05T00:00:03Z', now()),
    ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000101', '2026-01-05T00:00:01Z', now()),
    ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000102', '2026-01-05T00:00:02Z', now()),
    ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000104', '2026-01-05T00:00:04Z', now()),
    ('e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000105', '2026-01-05T00:00:05Z', now());
`);
afterAll(() => db.close());

const photoOrigin = "https://storage.example";

interface Options {
  readonly at?: DateTime.Utc;
  readonly database?: PGlite;
}

/** Home as `options` set the clock and database. */
const readHome = (options: Options) =>
  Effect.provide(
    Home.use((repository) => repository.read(photoOrigin)),
    Home.layer.pipe(
      Layer.provideMerge(sqlLayer(options.database ?? db)),
      Layer.provideMerge(clockAt(options.at ?? now)),
    ),
  );

const read = (options: Options = {}): Promise<HomeView> =>
  Effect.runPromise(readHome(options));

const at = (iso: string) => DateTime.makeUnsafe(iso);
const slugs = (evenings: ReadonlyArray<{ readonly slug: string }>) =>
  evenings.map((evening) => evening.slug);

describe("Home", () => {
  test("leads with the live evening, then what's announced after it", async () => {
    const home = await read();
    expect(home.next).toEqual({
      slug: "2026-10-03-ends-now",
      name: "Ends now",
      topic: "ends now",
      status: "live",
      startsAt: at("2026-10-03T15:00:00Z"),
      neighborhood: null,
      hosts: [],
      rsvpUrl: null,
      curation: { kind: "ours" },
    });
    expect(slugs(home.afterThat)).toEqual([
      "2026-10-03-hack-day",
      "2026-11-05-upcoming",
      "2026-12-01-all-things-effect",
    ]);
    expect(home.afterThat.map((evening) => evening.status)).toEqual([
      "live",
      "upcoming",
      "upcoming",
    ]);
  });

  test("reads each evening's topic, neighborhood, hosts and Luma page", async () => {
    const home = await read({ at: at("2026-08-01T00:00:00Z") });
    expect(home.next).toEqual({
      slug: "2026-08-12-react-at-acme",
      name: "React at Acme",
      topic: "react",
      status: "upcoming",
      startsAt: at("2026-08-13T01:00:00Z"),
      neighborhood: null,
      hosts: ["Globex", "Acme"],
      rsvpUrl: "https://lu.ma/event/evt-react",
      curation: { kind: "ours" },
    });
    const effect = await read({ at: at("2026-11-07T00:00:00Z") });
    expect(effect.next).toMatchObject({
      name: "All Things Effect",
      topic: "effect",
      neighborhood: "East Cut",
      rsvpUrl: "https://lu.ma/event/evt-effect",
    });
  });

  test("takes the topic the site set over the one the name yields", async () => {
    const database = await seededDatabase();
    try {
      await database.exec(
        `UPDATE events SET name = 'Pre Next.js Conf / Ship AI Meetup', topic = 'ship ai' WHERE slug = '2026-08-12-react-at-acme';
         UPDATE events SET name = 'TypeScript AI: The official conference after-party' WHERE slug = '2026-11-05-upcoming'`,
      );
      const home = await read({ at: at("2026-08-01T00:00:00Z"), database });
      expect(home.next).toMatchObject({
        name: "Pre Next.js Conf / Ship AI Meetup",
        topic: "ship ai",
      });
      // Without one, a name that yields none has none.
      expect(
        home.afterThat.find(
          (evening) => evening.slug === "2026-11-05-upcoming",
        ),
      ).toMatchObject({
        name: "TypeScript AI: The official conference after-party",
        topic: undefined,
      });
    } finally {
      await database.close();
    }
  });

  test(`lists at most ${afterThatLimit} evenings after the next one`, async () => {
    const home = await read({ at: at("2026-08-01T00:00:00Z") });
    expect(home.afterThat).toHaveLength(afterThatLimit);
    expect(slugs(home.afterThat)).toEqual([
      "2026-10-03-ends-now",
      "2026-10-03-hack-day",
      "2026-11-05-upcoming",
    ]);
  });

  test("lists the latest three evenings that have ended, latest first", async () => {
    expect(slugs((await read()).recently)).toEqual([
      "2026-08-12-react-at-acme",
      "2025-12-02-café-night",
    ]);
    const later = await read({ at: at("2027-01-01T00:00:00Z") });
    expect(later.next).toBeUndefined();
    expect(later.afterThat).toEqual([]);
    expect(slugs(later.recently)).toEqual([
      "2026-12-01-all-things-effect",
      "2026-11-05-upcoming",
      "2026-10-03-hack-day",
    ]);
    expect(later.recently.every((evening) => evening.status === "past")).toBe(
      true,
    );
  });

  test("an evening is ahead through the minute it ends in: pages read as of the minute", async () => {
    const end = await read({ at: at("2026-10-03T19:00:00.000Z") });
    expect(end.next?.slug).toBe("2026-10-03-ends-now");
    // The page reads as of 19:00 until 19:01, so it is still live.
    const sameMinute = await read({ at: at("2026-10-03T19:00:59.999Z") });
    expect(sameMinute.next).toMatchObject({
      slug: "2026-10-03-ends-now",
      status: "live",
    });
    const after = await read({ at: at("2026-10-03T19:01:00.000Z") });
    expect(after.next?.slug).toBe("2026-10-03-hack-day");
    expect(after.recently[0]?.slug).toBe("2026-10-03-ends-now");
  });

  test("never shows a draft", async () => {
    for (const iso of ["2026-08-20T00:00:00Z", "2026-09-10T00:00:00Z"]) {
      const home = await read({ at: at(iso) });
      const all = [
        ...(home.next === undefined ? [] : [home.next]),
        ...home.afterThat,
        ...home.recently,
      ];
      expect(slugs(all)).not.toContain("2026-09-01-draft-night");
      expect(home.photos.map((photo) => photo.alt)).not.toContain("A draft");
    }
  });

  test("shows the first photo on the photo origin of each of the latest evenings that have ended", async () => {
    // The stage's row was last changed at 2026-01-02T03:04:05.678Z.
    await db.exec(
      "UPDATE images SET updated_at = '2026-01-02T03:04:05.678Z' WHERE id = 'd0000000-0000-4000-8000-000000000004'",
    );
    const [stage, cafe, ...more] = (await read()).photos;
    expect(stage).toEqual({
      url: "https://storage.example/photos/stage.jpg",
      alt: "The stage",
      width: 1600,
      height: 900,
      version: "1767323045",
    });
    expect(cafe).toEqual({
      url: "https://storage.example/photos/cafe.jpg",
      alt: "Coffee at Café night",
      width: 1200,
      height: 800,
      version: expect.stringMatching(/^[0-9]+$/),
    });
    expect(more).toEqual([]);
    // Before React at Acme ends, only Café night has photos to show.
    const before = await read({ at: at("2026-08-01T00:00:00Z") });
    expect(before.photos.map((photo) => photo.alt)).toEqual([
      "Coffee at Café night",
    ]);
    // An upcoming evening's photo waits until it has happened.
    const later = await read({ at: at("2027-01-01T00:00:00Z") });
    expect(later.photos.map((photo) => photo.alt)).toEqual([
      "Not yet",
      "The stage",
      "Coffee at Café night",
    ]);
  });

  test("leads with our next evening, never one we only share, which it lists marked", async () => {
    const shared = await seededDatabase();
    try {
      await shared.exec(`
        INSERT INTO sponsors (id, name, about, website_url, twitter_handle, updated_at) VALUES
          ('c0000000-0000-4000-8000-000000000900', 'Mastra', 'Agents in TypeScript.', 'https://mastra.ai', 'mastra', now());
        UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
          WHERE slug IN ('2026-10-03-ends-now', '2026-08-12-react-at-acme');
      `);
      const home = await read({ database: shared });
      expect(home.next?.slug).toBe("2026-10-03-hack-day");
      expect(slugs(home.afterThat)).toEqual([
        "2026-10-03-ends-now",
        "2026-11-05-upcoming",
      ]);
      expect(home.afterThat[0]?.curation).toEqual({
        kind: "shared",
        organizer: {
          name: "Mastra",
          websiteUrl: "https://mastra.ai",
          twitterHandle: "mastra",
          blueskyHandle: null,
          linkedinHandle: null,
        },
      });
      // Shared, it is named as written: no allthings/<topic>.
      expect(home.afterThat[0]?.topic).toBeUndefined();
      // Photos are of our evenings alone.
      expect(home.photos.map((photo) => photo.alt)).not.toContain("The stage");
    } finally {
      await shared.close();
    }
  });

  test("fails as DataSourceError when the database does", async () => {
    const empty = await PGlite.create();
    try {
      const error = await Effect.runPromise(
        Effect.flip(readHome({ database: empty })),
      );
      expect(error).toBeInstanceOf(DataSourceError);
    } finally {
      await empty.close();
    }
  });
});
