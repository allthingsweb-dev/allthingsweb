import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import { DataSourceError, EventNotFound } from "../src/errors.ts";
import {
  type EventPage,
  EventPages,
  photoLimit,
  toVenue,
} from "../src/event-page.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Event pages against the migrated production schema: tests/seed.sql, plus
 * more photos for React at Acme than a page shows, one of them on another
 * origin, and a topic the site set.
 */

const db = await seededDatabase();
const extraPhotos = Array.from({ length: photoLimit }, (_, index) => index);
await db.exec(`
  INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
    ('d0000000-0000-4000-8000-000000000200', 'https://elsewhere.example/photo.jpg', '', 'Elsewhere', 800, 600, now()),
    ${extraPhotos
      .map(
        (index) =>
          `('d0000000-0000-4000-8000-00000000021${index}', 'https://storage.example/photos/more-${index}.jpg', '', 'More ${index}', 1200, 800, now())`,
      )
      .join(",\n    ")};
  INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000200', '2026-01-04T00:00:00Z', now()),
    ${extraPhotos
      .map(
        (index) =>
          `('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000021${index}', '2026-01-04T00:00:1${index}Z', now())`,
      )
      .join(",\n    ")};
  UPDATE events SET topic = 'coffee & code' WHERE slug = '2025-12-02-café-night';
`);
afterAll(() => db.close());

const photoOrigin = "https://storage.example";
const at = (iso: string) => DateTime.makeUnsafe(iso);

/** The page at `slug`, read at `instant` from `database`. */
const readPage = (
  slug: string,
  instant: DateTime.Utc = now,
  database: PGlite = db,
) =>
  Effect.provide(
    EventPages.use((pages) => pages.read(slug, photoOrigin)),
    EventPages.layer.pipe(
      Layer.provideMerge(sqlLayer(database)),
      Layer.provideMerge(clockAt(instant)),
    ),
  );

const read = (slug: string, instant?: DateTime.Utc): Promise<EventPage> =>
  Effect.runPromise(readPage(slug, instant));

describe("EventPages", () => {
  test("reads a past evening with everything it has", async () => {
    const page = await read("2026-08-12-react-at-acme");
    expect(page).toMatchObject({
      id: "e0000000-0000-4000-8000-000000000001",
      slug: "2026-08-12-react-at-acme",
      name: "React at Acme",
      topic: "react",
      tagline: "Server components in practice",
      status: "past",
      // 6 PM on Wednesday, August 12, in San Francisco.
      mode: "night",
      startsAt: at("2026-08-13T01:00:00Z"),
      endsAt: at("2026-08-13T04:00:00Z"),
      venue: {
        neighborhood: null,
        name: "Acme HQ",
        address: "1 Market St, San Francisco, CA 94105",
        mapQuery: "1 Market St, San Francisco, CA 94105",
      },
      hosts: ["Globex", "Acme"],
      rsvpUrl: "https://lu.ma/event/evt-react",
      seats: 120,
      recordingUrl: "https://www.youtube.com/watch?v=abc123",
    });
    expect(DateTime.isDateTime(page.updatedAt)).toBe(true);
  });

  test("lists every talk with all its speakers, in the order they were attached", async () => {
    const { talks } = await read("2026-08-12-react-at-acme");
    expect(talks.map((talk) => talk.title)).toEqual([
      "Effect in production",
      "Server components",
    ]);
    const [effect, rsc] = talks;
    expect(String(effect?.description)).toBe(
      "<p>Typed errors<br />and services.</p>",
    );
    expect(effect?.speakers.map((speaker) => speaker.name)).toEqual(["Linus"]);
    expect(rsc?.speakers).toEqual([
      {
        id: "b0000000-0000-4000-8000-000000000002",
        name: "Grace Hopper",
        title: "Admiral",
        bio: null,
        links: {
          x: null,
          bluesky: null,
          linkedin: "https://www.linkedin.com/in/grace%20hopper",
        },
        portrait: null,
      },
      {
        id: "b0000000-0000-4000-8000-000000000001",
        name: "Ada Lovelace",
        title: "Engineer",
        bio: "Writes compilers.",
        links: {
          x: "https://twitter.com/ada",
          bluesky: "https://bsky.app/profile/ada.bsky.social",
          linkedin: "https://www.linkedin.com/in/ada-lovelace",
        },
        portrait: {
          url: "https://storage.example/people/ada.jpg",
          alt: "Ada Lovelace",
          width: 400,
          height: 400,
        },
      },
    ]);
  });

  test("shows the first photos on the photo origin, in the order they were attached, up to the limit", async () => {
    const { photos } = await read("2026-08-12-react-at-acme");
    expect(photos).toHaveLength(photoLimit);
    expect(photos.map((photo) => photo.alt)).toEqual([
      "The stage",
      "The crowd",
      ...extraPhotos.slice(0, photoLimit - 2).map((index) => `More ${index}`),
    ]);
    expect(photos[0]).toEqual({
      url: "https://storage.example/photos/stage.jpg",
      alt: "The stage",
      width: 1600,
      height: 900,
    });
  });

  test("leaves a speaker's photo on another origin out", async () => {
    const { talks } = await Effect.runPromise(
      Effect.provide(
        EventPages.use((pages) =>
          pages.read("2026-08-12-react-at-acme", "https://elsewhere.example"),
        ),
        EventPages.layer.pipe(
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockAt(now)),
        ),
      ),
    );
    const ada = talks[1]?.speakers[1];
    expect(ada?.name).toBe("Ada Lovelace");
    expect(ada?.portrait).toBeNull();
  });

  test("points a past evening to the live or next one", async () => {
    // At the test clock, Ends now is live until its last millisecond.
    expect((await read("2026-08-12-react-at-acme")).next).toMatchObject({
      slug: "2026-10-03-ends-now",
      status: "live",
    });
    // Never to itself.
    expect((await read("2026-10-03-ends-now")).next?.slug).toBe(
      "2026-10-03-hack-day",
    );
    // Nothing announced: nothing next.
    const later = await read(
      "2026-08-12-react-at-acme",
      at("2027-01-01T00:00:00Z"),
    );
    expect(later.next).toBeUndefined();
  });

  test("reads a live daytime hackathon without a venue or Luma page", async () => {
    const page = await read("2026-10-03-hack-day");
    expect(page).toMatchObject({
      status: "live",
      // 9 AM in San Francisco.
      mode: "paper",
      venue: null,
      rsvpUrl: null,
      seats: 80,
      recordingUrl: null,
      photos: [],
    });
    // A talk that says nothing has no description.
    expect(page.talks).toEqual([
      expect.objectContaining({ title: "Hacking live", description: null }),
    ]);
  });

  test("reads an upcoming evening, its Luma id encoded", async () => {
    const page = await read("2026-11-05-upcoming");
    expect(page).toMatchObject({
      status: "upcoming",
      mode: "night",
      venue: { neighborhood: null, name: "TBA", address: null, mapQuery: null },
      rsvpUrl: "https://lu.ma/event/evt%20with%20space",
    });
  });

  test("takes the site's topic, and drops a recording that isn't an http(s) URL", async () => {
    const page = await read("2025-12-02-café-night");
    expect(page).toMatchObject({
      name: "Café night",
      topic: "coffee & code",
      recordingUrl: null,
      venue: {
        neighborhood: null,
        name: null,
        address: "500 Coffee Ave, Oakland, CA",
        mapQuery: "500 Coffee Ave, Oakland, CA",
      },
    });
  });

  test("finds neither a draft nor an unknown slug", async () => {
    for (const slug of ["2026-09-01-draft-night", "no-such-evening", ""]) {
      const error = await Effect.runPromise(Effect.flip(readPage(slug)));
      expect(error).toBeInstanceOf(EventNotFound);
      expect(error).toMatchObject({ slug });
    }
  });

  test("matches the slug exactly", async () => {
    const error = await Effect.runPromise(
      Effect.flip(readPage("2026-08-12-REACT-at-acme")),
    );
    expect(error).toBeInstanceOf(EventNotFound);
  });

  test("fails as a DataSourceError when the database can't answer", async () => {
    const broken = await seededDatabase();
    try {
      await broken.exec("DROP TABLE talks CASCADE");
      const error = await Effect.runPromise(
        Effect.flip(readPage("2026-08-12-react-at-acme", now, broken)),
      );
      expect(error).toBeInstanceOf(DataSourceError);
    } finally {
      await broken.close();
    }
  });
});

describe("toVenue", () => {
  const venue = (
    shortLocation: string | null,
    fullAddress: string | null,
    streetAddress: string | null = null,
  ) => toVenue({ shortLocation, fullAddress, streetAddress });

  test("prints the venue beside the rest of an address Luma starts with it", () => {
    expect(
      venue(
        "CodeRabbit",
        "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
      ),
    ).toEqual({
      neighborhood: "East Cut",
      name: "CodeRabbit",
      address: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
      mapQuery:
        "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
    });
  });

  test("names no venue that is only the start of the address", () => {
    expect(
      venue("201 Spear St", "201 Spear St, San Francisco, CA 94105, USA"),
    ).toEqual({
      neighborhood: "East Cut",
      name: null,
      address: "201 Spear St, San Francisco, CA 94105, USA",
      mapQuery: "201 Spear St, San Francisco, CA 94105, USA",
    });
  });

  test("keeps a venue name the address doesn't repeat", () => {
    expect(
      venue(
        "Convex HQ",
        "444 De Haro St #218, San Francisco, CA 94107, USA",
        "444 De Haro St #218",
      ),
    ).toEqual({
      neighborhood: "Potrero Hill",
      name: "Convex HQ",
      address: "444 De Haro St #218, San Francisco, CA 94107, USA",
      mapQuery: "444 De Haro St #218, San Francisco, CA 94107, USA",
    });
  });

  test("matches the venue's name as a whole word", () => {
    expect(venue("Mux", "Muxworks, 1 Main St, San Francisco")).toMatchObject({
      name: "Mux",
      address: "Muxworks, 1 Main St, San Francisco",
    });
  });

  test("falls back to the street address, and trims what it prints", () => {
    expect(venue("  Little Skillet ", null, " 360 Ritch Street ")).toEqual({
      neighborhood: "SoMa",
      name: "Little Skillet",
      address: "360 Ritch Street",
      mapQuery: "360 Ritch Street",
    });
  });

  test("is nothing when nothing is known", () => {
    expect(venue(null, null)).toBeNull();
    expect(venue("  ", "", " ")).toBeNull();
  });
});
