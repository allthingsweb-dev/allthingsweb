import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import { About, type AboutView, formerNames } from "../src/about.ts";
import { DataSourceError } from "../src/errors.ts";
import { guestCountFloor } from "../src/event-page.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The about page against the migrated production schema: tests/seed.sql,
 * plus evenings under each former name, a draft and an evening ahead that
 * must not count, and guest counts on either side of the floor.
 */

const db = await seededDatabase();
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, luma_guest_count, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000701', '2024-03-26-remix-bay-area-at-solv', 'Remix Bay Area at Solv', '', '2024-03-27T00:00:00Z', '2024-03-27T03:00:00Z', 100, '760 Market St #1150', 'Solv, SF', NULL, NULL, false, false, NULL, now()),
    ('e0000000-0000-4000-8000-000000000702', '2024-07-30-react-bay-area-at-sanity', 'React Bay Area at Sanity', '', '2024-07-31T00:00:00Z', '2024-07-31T03:00:00Z', 100, '351 California St', NULL, NULL, NULL, false, false, ${guestCountFloor - 1}, now()),
    ('e0000000-0000-4000-8000-000000000703', '2024-08-27-react-bay-area-at-mux', 'react bay area at Mux', '', '2024-08-28T00:00:00Z', '2024-08-28T03:00:00Z', 100, NULL, NULL, NULL, NULL, false, false, ${guestCountFloor}, now()),
    -- A draft before them all: never counted, never first.
    ('e0000000-0000-4000-8000-000000000704', '2024-01-01-all-things-web-draft', 'All Things Web Draft', '', '2024-01-02T00:00:00Z', '2024-01-02T03:00:00Z', 100, NULL, NULL, NULL, NULL, false, true, 500, now()),
    ('e0000000-0000-4000-8000-000000000705', '2024-11-04', 'All Things Web at Little Skillet', '', '2024-11-05T01:00:00Z', '2024-11-05T04:00:00Z', 20, '360 Ritch St', NULL, NULL, NULL, false, false, 6, now()),
    ('e0000000-0000-4000-8000-000000000706', '2024-11-12-all-things-web-at-vercel', 'All Things Web @ Vercel HQ 👀', '', '2024-11-13T01:00:00Z', '2024-11-13T04:00:00Z', 50, NULL, NULL, NULL, NULL, false, false, 98, now()),
    -- Ahead: not held yet, so not counted, however it is named.
    ('e0000000-0000-4000-8000-000000000707', '2027-01-01-remix-bay-area-again', 'Remix Bay Area again', '', '2027-01-02T01:00:00Z', '2027-01-02T04:00:00Z', 50, NULL, NULL, NULL, NULL, false, false, 300, now());
`);
afterAll(() => db.close());

const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const photoOrigin = "https://storage.example";

const readAbout = (
  organizerIds: ReadonlyArray<string>,
  database: PGlite = db,
  instant: DateTime.Utc = now,
) =>
  Effect.provide(
    About.use((about) => about.read(organizerIds, photoOrigin)),
    About.layer.pipe(
      Layer.provideMerge(sqlLayer(database)),
      Layer.provideMerge(clockAt(instant)),
    ),
  );

const read = (organizerIds: ReadonlyArray<string> = [grace, ada]) =>
  Effect.runPromise(readAbout(organizerIds));

describe("About", () => {
  test("counts the evenings held, who was on stage, who hosted, and who came", async () => {
    const about: AboutView = await read();
    // React at Acme and Café night (tests/seed.sql) and the five held here;
    // not the draft, not the evening ahead, not Ends now, which is live.
    expect(about.evenings).toBe(7);
    // Linus, Grace and Ada, each once, though Server components was given twice.
    expect(about.speakers).toBe(3);
    // Acme and Globex.
    expect(about.hostingCompanies).toBe(2);
    // React at Acme's 118, Mux's 20 and Vercel's 98; not 19, 6, the draft's
    // or the evening ahead's.
    expect(about.guests).toBe(118 + guestCountFloor + 98);
  });

  test("counts only our evenings, never one we only share", async () => {
    const shared = await seededDatabase();
    try {
      const before = await Effect.runPromise(readAbout([grace, ada], shared));
      await shared.exec(`
        INSERT INTO sponsors (id, name, about, updated_at) VALUES
          ('c0000000-0000-4000-8000-000000000900', 'Mastra', 'Agents.', now());
        UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
          WHERE slug = '2026-08-12-react-at-acme';`);
      const after = await Effect.runPromise(readAbout([grace, ada], shared));
      expect(after.evenings).toBe(before.evenings - 1);
      // React at Acme's 118 guests are no longer ours to count.
      expect(after.guests).toBe(before.guests - 118);
    } finally {
      await shared.close();
    }
  });

  test("finds the first evening, and where each former name first appeared", async () => {
    const about = await read();
    expect(about.first).toMatchObject({
      slug: "2024-03-26-remix-bay-area-at-solv",
      name: "Remix Bay Area at Solv",
      neighborhood: "Union Square",
      status: "past",
    });
    expect(
      about.formerNames.map(({ name, evening }) => [name, evening.slug]),
    ).toEqual([
      ["Remix Bay Area", "2024-03-26-remix-bay-area-at-solv"],
      ["React Bay Area", "2024-07-30-react-bay-area-at-sanity"],
      ["All Things Web", "2024-11-04"],
    ]);
    expect(formerNames).toEqual([
      "Remix Bay Area",
      "React Bay Area",
      "All Things Web",
    ]);
  });

  test("names a former name only when an evening went by it", async () => {
    const database = await seededDatabase();
    try {
      const about = await Effect.runPromise(readAbout([], database));
      expect(about.formerNames).toEqual([]);
      expect(about.first?.slug).toBe("2025-12-02-café-night");
      expect(about.organizers).toEqual([]);
      // Before anything has happened, there is nothing to count.
      const before = await Effect.runPromise(
        readAbout([], database, DateTime.makeUnsafe("2020-01-01T00:00:00Z")),
      );
      expect(before).toMatchObject({
        evenings: 0,
        speakers: 0,
        hostingCompanies: 0,
        guests: 0,
        first: undefined,
      });
    } finally {
      await database.close();
    }
  });

  test("reads the organizers asked for, in that order, as their profiles have them", async () => {
    const about = await read([
      grace,
      "00000000-0000-4000-8000-000000000000",
      ada,
    ]);
    expect(about.organizers).toEqual([
      {
        id: grace,
        name: "Grace Hopper",
        title: "Admiral",
        bio: null,
        links: {
          x: null,
          bluesky: null,
          linkedin: "https://www.linkedin.com/in/grace%20hopper",
        },
        photo: null,
      },
      {
        id: ada,
        name: "Ada Lovelace",
        title: "Engineer",
        bio: "Writes compilers.",
        links: {
          x: "https://twitter.com/ada",
          bluesky: "https://bsky.app/profile/ada.bsky.social",
          linkedin: "https://www.linkedin.com/in/ada-lovelace",
        },
        photo: {
          url: "https://storage.example/people/ada.jpg",
          alt: "Ada Lovelace",
          width: 400,
          height: 400,
          version: expect.stringMatching(/^[0-9]+$/),
        },
      },
    ]);
  });

  test("fails as a DataSourceError when the database can't answer", async () => {
    const broken = await seededDatabase();
    try {
      await broken.exec("DROP TABLE event_sponsors CASCADE");
      const error = await Effect.runPromise(
        Effect.flip(readAbout([ada], broken)),
      );
      expect(error).toBeInstanceOf(DataSourceError);
    } finally {
      await broken.close();
    }
  });
});
