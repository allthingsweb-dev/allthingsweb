import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import { DataSourceError, EventNotFound } from "../src/errors.ts";
import {
  type EventPage,
  EventPages,
  excerpt,
  guestCountFloor,
  postLimit,
  toVenue,
} from "../src/event-page.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Event pages against the migrated production schema: tests/seed.sql, plus
 * six more photos for React at Acme, one more on another origin, a topic
 * the site set, and Hack day's schedule and notes.
 */

const db = await seededDatabase();
const extraPhotos = Array.from({ length: 6 }, (_, index) => index);
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
  -- Hack day's schedule and notes, written out of order.
  INSERT INTO event_schedule_items (event_id, position, time, title, description, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000003', 1, ' 1 - 7 pm ', ' Hacking time ', '  ', now()),
    ('e0000000-0000-4000-8000-000000000003', 0, '9 am', 'Doors open', 'Form teams.', now());
  INSERT INTO event_notes (event_id, position, label, body, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000003', 2, 'Theme', '<p>Open <strong>source</strong></p><script>alert(1)</script>', now()),
    ('e0000000-0000-4000-8000-000000000003', 0, ' Awards ', '<p>Swag &amp; <a href="https://prizes.example/">credits</a></p>', now()),
    ('e0000000-0000-4000-8000-000000000003', 1, 'Empty', '<p> </p>', now()),
    ('e0000000-0000-4000-8000-000000000003', 3, '  ', '<p>No label</p>', now());
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
      // Only Acme has a site on record.
      hostSites: { Acme: "https://acme.example/" },
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
        slug: "grace-hopper",
        name: "Grace Hopper",
        title: "Admiral",
        bio: null,
        links: {
          x: null,
          bluesky: null,
          linkedin: "https://www.linkedin.com/in/grace%20hopper",
        },
        portrait: null,
        role: "speaker",
      },
      {
        id: "b0000000-0000-4000-8000-000000000001",
        slug: "ada-lovelace",
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
          version: expect.stringMatching(/^[0-9]+$/),
        },
        role: "speaker",
      },
    ]);
    expect(talks.map((talk) => talk.format)).toEqual(["talk", "talk"]);
  });

  test("lists talks in the evening's running order, with their starts; talks without a place follow, as attached", async () => {
    const database = await seededDatabase();
    try {
      await database.exec(`
        INSERT INTO talks (id, title, description, updated_at) VALUES
          ('a0000000-0000-4000-8000-000000000099', 'Unplaced', '', now());
        INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
          ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000099', '2026-01-01T00:00:00Z', now());
        UPDATE event_talks SET position = 0, starts_at = '2026-08-13T01:41:00Z'
          WHERE talk_id = 'a0000000-0000-4000-8000-000000000001'
            AND event_id = 'e0000000-0000-4000-8000-000000000001';
        UPDATE event_talks SET position = 1
          WHERE talk_id = 'a0000000-0000-4000-8000-000000000002'
            AND event_id = 'e0000000-0000-4000-8000-000000000001';
      `);
      const { talks } = await readPage(
        "2026-08-12-react-at-acme",
        now,
        database,
      ).pipe(Effect.runPromise);
      // Server components was attached second but is placed first; the
      // unplaced talk, attached earliest, still follows the placed ones.
      expect(talks.map((talk) => talk.title)).toEqual([
        "Server components",
        "Effect in production",
        "Unplaced",
      ]);
      expect(
        talks.map((talk) =>
          talk.startsAt === null ? null : DateTime.formatIso(talk.startsAt),
        ),
      ).toEqual(["2026-08-13T01:41:00.000Z", null, null]);
    } finally {
      await database.close();
    }
  });

  test("reads who organized and co-hosted it, the MC, and how many went", async () => {
    const page = await read("2026-08-12-react-at-acme");
    // Luma counted 118 guests (tests/seed.sql); no people are recorded.
    expect(page.guests).toBe(118);
    expect([page.organizers, page.coHosts, page.mcs]).toEqual([[], [], []]);
    const database = await seededDatabase();
    try {
      await database.exec(`
        UPDATE events SET luma_guest_count = 0 WHERE slug = '2026-08-12-react-at-acme';
        UPDATE talks SET format = 'fireside' WHERE id = 'a0000000-0000-4000-8000-000000000001';
        UPDATE talks SET format = 'panel' WHERE id = 'a0000000-0000-4000-8000-000000000002';
        UPDATE talk_speakers SET role = 'moderator'
          WHERE talk_id = 'a0000000-0000-4000-8000-000000000001'
            AND speaker_id = 'b0000000-0000-4000-8000-000000000002';
        INSERT INTO event_people (event_id, profile_id, role, position, source, created_at, updated_at) VALUES
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'mc', 0, 'site', now(), now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'co-host', 1, 'luma', now(), now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000006', 'co-host', 0, 'luma', now(), now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'organizer', 0, 'site', now(), now());
      `);
      const people = await Effect.runPromise(
        readPage("2026-08-12-react-at-acme", now, database),
      );
      expect(people.guests).toBeNull();
      expect(people.organizers.map((person) => person.name)).toEqual([
        "Grace Hopper",
      ]);
      expect(people.coHosts).toEqual([
        {
          id: "b0000000-0000-4000-8000-000000000006",
          slug: "zed-nobody",
          name: "Zed Nobody",
          title: null,
          portrait: null,
        },
        {
          id: "b0000000-0000-4000-8000-000000000001",
          slug: "ada-lovelace",
          name: "Ada Lovelace",
          title: "Engineer",
          portrait: {
            url: "https://storage.example/people/ada.jpg",
            alt: "Ada Lovelace",
            width: 400,
            height: 400,
            version: expect.stringMatching(/^[0-9]+$/),
          },
        },
      ]);
      expect(people.mcs.map((person) => person.name)).toEqual(["Linus"]);
      const [panel, fireside] = people.talks;
      expect(panel?.format).toBe("panel");
      expect(panel?.speakers.map((speaker) => speaker.role)).toEqual([
        "panelist",
      ]);
      expect(fireside?.format).toBe("fireside");
      expect(
        fireside?.speakers.map((speaker) => [speaker.name, speaker.role]),
      ).toEqual([
        ["Grace Hopper", "moderator"],
        ["Ada Lovelace", "guest"],
      ]);
    } finally {
      await database.close();
    }
  });

  test("shows every photo on the photo origin, in the order they were attached", async () => {
    const { photos } = await read("2026-08-12-react-at-acme");
    expect(photos.map((photo) => photo.alt)).toEqual([
      "The stage",
      "The crowd",
      ...extraPhotos.map((index) => `More ${index}`),
    ]);
    expect(photos[0]).toEqual({
      url: "https://storage.example/photos/stage.jpg",
      alt: "The stage",
      width: 1600,
      height: 900,
      version: expect.stringMatching(/^[0-9]+$/),
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
      program: "hackathon",
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

  test("reads the schedule and notes in their order, trimmed and sanitized", async () => {
    const page = await read("2026-10-03-hack-day");
    expect(page.schedule).toEqual([
      { time: "9 am", title: "Doors open", description: "Form teams." },
      // A description that says nothing is none.
      { time: "1 - 7 pm", title: "Hacking time", description: null },
    ]);
    // Notes keep formatting and safe links only; one without a label or
    // anything to say is left out.
    expect(
      page.notes.map((note) => ({
        label: note.label,
        body: String(note.body),
      })),
    ).toEqual([
      {
        label: "Awards",
        body: '<p>Swag &amp; <a href="https://prizes.example/" target="_blank" rel="noopener noreferrer">credits</a></p>',
      },
      { label: "Theme", body: "<p>Open <strong>source</strong></p>" },
    ]);
  });

  test("reads no schedule and no notes where none are recorded", async () => {
    const page = await read("2026-08-12-react-at-acme");
    expect(page.schedule).toEqual([]);
    expect(page.program).toBe("talks");
    expect(page.notes).toEqual([]);
  });

  test("says what the evening is about in Luma's words, unless the site has its own", async () => {
    const acme = "2026-08-12-react-at-acme";
    expect<string | null>((await read(acme)).about).toBe(
      "<p>Server components in practice, with <strong>two talks</strong> and time to talk after.</p>\n",
    );
    expect((await read("2026-11-05-upcoming")).about).toBeNull();
    const database = await seededDatabase();
    try {
      const about = (description: string) =>
        database
          .query("UPDATE events SET description = $1 WHERE slug = $2", [
            description,
            acme,
          ])
          .then(() => Effect.runPromise(readPage(acme, now, database)))
          .then((page): string | null => page.about);
      // The site's own wins, sanitized.
      expect(
        await about('<p>Our <em>own</em> words.</p><img src="x" onerror="1">'),
      ).toBe("<p>Our <em>own</em> words.</p>");
      // One that says nothing leaves Luma's.
      expect(await about("<p> </p>")).toStartWith(
        "<p>Server components in practice",
      );
    } finally {
      await database.close();
    }
  });

  test("lets Luma's summary stand in for a placeholder tagline, never for the organizers'", async () => {
    const database = await seededDatabase();
    try {
      const tagline = async (stored: string, summary: string | null) => {
        await database.query(
          "UPDATE events SET tagline = $1, luma_summary = $2 WHERE slug = $3",
          [stored, summary, "2026-08-12-react-at-acme"],
        );
        return (
          await Effect.runPromise(
            readPage("2026-08-12-react-at-acme", now, database),
          )
        ).tagline;
      };
      expect(
        await tagline("See Luma for event details and registration.", "Talks."),
      ).toBe("Talks.");
      // Words that only end like the first sync's are an organizer's.
      expect(
        await tagline("Come build with us at All Things Web", "Talks."),
      ).toBe("Come build with us at All Things Web");
      expect(
        await tagline("See Luma for event details and registration.", null),
      ).toBe("");
      expect(await tagline("  Our own words  ", "Talks.")).toBe(
        "Our own words",
      );
    } finally {
      await database.close();
    }
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

describe("posts about the evening", () => {
  test("lists the approved ones, earliest first, with their copied images", async () => {
    const { posts, morePosts } = await read("2026-08-12-react-at-acme");
    expect(morePosts).toBe(0);
    expect(posts).toEqual([
      {
        url: "https://x.com/i/status/1900000000000000001",
        platform: "x",
        authorName: "Ada Lovelace",
        authorHandle: "ada",
        authorUrl: "https://x.com/ada",
        postedAt: at("2026-08-13T02:30:00Z"),
        text: "Server components, live at Acme.",
        image: {
          url: "https://storage.example/photos/stage.jpg",
          alt: "The stage",
          width: 1600,
          height: 900,
          version: expect.stringMatching(/^[0-9]+$/),
        },
        avatar: {
          url: "https://storage.example/people/ada.jpg",
          alt: "Ada Lovelace",
          width: 400,
          height: 400,
          version: expect.stringMatching(/^[0-9]+$/),
        },
      },
      {
        url: "https://bsky.app/profile/did:plc:grace/post/3abc",
        platform: "bluesky",
        authorName: "Grace Hopper",
        authorHandle: "grace.example",
        authorUrl: "https://bsky.app/profile/grace.example",
        postedAt: at("2026-08-13T05:00:00Z"),
        text: "Thanks, Acme!\nSee you next month.",
        image: null,
        avatar: null,
      },
    ]);
  });

  test("an evening without posts has none", async () => {
    const page = await read("2025-12-02-café-night");
    expect(page.posts).toEqual([]);
    expect(page.morePosts).toBe(0);
  });

  test(`lists at most ${postLimit}, counts the rest, and keeps images on the photo origin only`, async () => {
    const database = await seededDatabase();
    try {
      await database.exec(`
        INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
          ('d0000000-0000-4000-8000-000000000300', 'https://pbs.twimg.com/media/elsewhere.jpg', '', 'Elsewhere', 800, 600, now());
        INSERT INTO event_posts (event_id, platform, url, author_name, posted_at, text, image, author_url, status, updated_at)
        SELECT 'e0000000-0000-4000-8000-000000000006', 'x', 'https://x.com/i/status/' || n,
          'Poster ' || n, '2025-12-03T06:00:00Z'::timestamptz + n * interval '1 minute',
          'Post ' || n, 'd0000000-0000-4000-8000-000000000300', 'javascript:alert(1)',
          'approved', now()
        FROM generate_series(1, ${postLimit + 3}) AS n;
      `);
      const { posts, morePosts } = await Effect.runPromise(
        readPage("2025-12-02-café-night", now, database),
      );
      expect(posts.map((post) => post.text)).toEqual(
        Array.from({ length: postLimit }, (_, index) => `Post ${index + 1}`),
      );
      expect(morePosts).toBe(3);
      expect(posts.every((post) => post.image === null)).toBe(true);
      expect(posts.every((post) => post.authorUrl === null)).toBe(true);
    } finally {
      await database.close();
    }
  });

  test.each([
    ["short", 20, "short"],
    ["  trimmed  ", 20, "trimmed"],
    ["one two three four five", 20, "one two three four…"],
    // No word ends near the limit: cut where it falls.
    ["one two three four five", 12, "one two thr…"],
    ["abcdefghijklmnopqrstuvwxyz", 10, "abcdefghi…"],
    ["😀😀😀😀😀😀", 4, "😀😀😀…"],
    // A flag and a family are one character each.
    ["🇺🇸🇺🇸👨‍👩‍👧🇺🇸", 3, "🇺🇸🇺🇸…"],
  ])("excerpt(%j, %i) is %j", (text, limit, expected) => {
    expect(excerpt(text, limit)).toBe(expected);
  });
});

describe("the guest count", () => {
  test(`is said from ${guestCountFloor} guests, and below that left unsaid`, async () => {
    expect(guestCountFloor).toBe(20);
    const database = await seededDatabase();
    try {
      const guests = async (count: number | null) => {
        await database.query(
          "UPDATE events SET luma_guest_count = $1 WHERE slug = '2026-08-12-react-at-acme'",
          [count],
        );
        const page = await Effect.runPromise(
          readPage("2026-08-12-react-at-acme", now, database),
        );
        return page.guests;
      };
      expect(await guests(guestCountFloor - 1)).toBeNull();
      expect(await guests(guestCountFloor)).toBe(guestCountFloor);
      expect(await guests(guestCountFloor + 1)).toBe(guestCountFloor + 1);
      expect(await guests(0)).toBeNull();
      expect(await guests(null)).toBeNull();
    } finally {
      await database.close();
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
