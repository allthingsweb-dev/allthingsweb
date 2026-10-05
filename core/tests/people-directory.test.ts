import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { DataSourceError } from "../src/errors.ts";
import {
  PeopleDirectory,
  type PeopleView,
  type PersonRow,
  shortBio,
  toPeople,
  toPerson,
} from "../src/people-directory.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * PeopleDirectory against the migrated production schema and
 * tests/seed.sql, plus evenings' people. Grace Hopper (who spoke) and
 * Unattached (who never did) stand in for the organizers asked for; Olga
 * organized Café night; Linus co-hosted React at Acme besides his talks;
 * Mia MCs the live hack day, where Ada moderates a fireside chat; Zed's
 * lightning talk was a panel. A co-host of the draft must never show.
 */

const grace = "b0000000-0000-4000-8000-000000000002";
const unattached = "b0000000-0000-4000-8000-000000000007";
const photoOrigin = "https://storage.example";

const db = await seededDatabase();
await db.exec(`
  INSERT INTO profiles (id, name, title, image, bio, profile_type, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000101', 'Olga Organizer', 'Organizer', NULL, '', 'organizer', now()),
    ('b0000000-0000-4000-8000-000000000102', 'Mia MC', '', NULL, '', 'member', now()),
    ('b0000000-0000-4000-8000-000000000103', 'Draft Host', '', NULL, '', 'member', now());
  UPDATE talks SET format = 'fireside' WHERE id = 'a0000000-0000-4000-8000-000000000004';
  UPDATE talk_speakers SET role = 'moderator'
    WHERE talk_id = 'a0000000-0000-4000-8000-000000000004' AND speaker_id = 'b0000000-0000-4000-8000-000000000001';
  UPDATE talks SET format = 'panel' WHERE id = 'a0000000-0000-4000-8000-000000000006';
  INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000101', 'organizer', 0, 'site', now()),
    ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'co-host', 0, 'luma', now()),
    ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000102', 'mc', 0, 'site', now()),
    ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000103', 'co-host', 0, 'luma', now());
`);
afterAll(() => db.close());

const readFrom = (
  database: typeof db,
  organizerIds: ReadonlyArray<string>,
  at: DateTime.Utc = now,
): Promise<PeopleView> =>
  Effect.runPromise(
    Effect.provide(
      PeopleDirectory.use((repository) =>
        repository.read(organizerIds, photoOrigin),
      ),
      PeopleDirectory.layer.pipe(
        Layer.provideMerge(sqlLayer(database)),
        Layer.provideMerge(clockAt(at)),
      ),
    ),
  );

const read = (organizerIds: ReadonlyArray<string> = [grace, unattached]) =>
  readFrom(db, organizerIds);

const names = (people: ReadonlyArray<{ readonly name: string }>) =>
  people.map((person) => person.name);

const at = (iso: string) => DateTime.makeUnsafe(iso);

describe("PeopleDirectory", () => {
  test("puts the organizers asked for first, in that order, then those an evening names", async () => {
    const { organizers } = await read();
    expect(names(organizers)).toEqual([
      "Grace Hopper",
      "Unattached",
      "Olga Organizer",
    ]);
    expect(organizers[1]).toEqual({
      id: unattached,
      name: "Unattached",
      title: "Lurker",
      bio: "No talks yet.",
      links: { x: null, bluesky: null, linkedin: null },
      photo: null,
      parts: [],
    });
    // Organizing is said by the group, never as a part.
    expect(organizers[2]?.parts).toEqual([]);
    expect(names((await read([unattached, grace])).organizers)).toEqual([
      "Unattached",
      "Grace Hopper",
      "Olga Organizer",
    ]);
  });

  test("lists every other speaker, whoever took part latest first", async () => {
    const { speakers } = await read();
    // Future Speaker's evening is ahead; Ada moderates at the live hack day,
    // after Zed's evening started; Linus last took part in August.
    expect(names(speakers)).toEqual([
      "Future Speaker",
      "Ada Lovelace",
      "Zed Nobody",
      "Linus",
    ]);
  });

  test("lists who co-hosted or MC'd without a talk on their own", async () => {
    const { coHosts, speakers } = await read();
    expect(names(coHosts)).toEqual(["Mia MC"]);
    expect(coHosts[0]?.parts).toEqual([
      {
        kind: "role",
        role: "mc",
        evening: {
          slug: "2026-10-03-hack-day",
          name: "Hack day",
          topic: "hack day",
          status: "live",
          startsAt: at("2026-10-03T16:00:00Z"),
        },
      },
    ]);
    // Linus has talks: he is a speaker, his co-hosting listed with them.
    const linus = speakers.find((person) => person.name === "Linus");
    expect(
      linus?.parts.map((part) => [
        part.kind,
        part.kind === "talk" ? part.title : part.role,
        part.evening.slug,
      ]),
    ).toEqual([
      ["talk", "Effect in production", "2026-08-12-react-at-acme"],
      ["role", "co-host", "2026-08-12-react-at-acme"],
      ["talk", "Coffee & code", "2025-12-02-café-night"],
    ]);
  });

  test("lists organizers' talks with them, not again among the speakers", async () => {
    const { organizers, speakers } = await read();
    expect(names(speakers)).not.toContain("Grace Hopper");
    expect(
      organizers[0]?.parts.map((part) => [part.kind, part.evening.slug]),
    ).toEqual([
      ["talk", "2026-08-12-react-at-acme"],
      ["talk", "2025-12-02-café-night"],
    ]);
  });

  test("names each part in its capacity, latest first, with each evening as lists name it", async () => {
    const { speakers } = await read();
    const ada = speakers.find((person) => person.name === "Ada Lovelace");
    expect(ada).toEqual({
      id: "b0000000-0000-4000-8000-000000000001",
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
      parts: [
        {
          kind: "talk",
          title: "Hacking live",
          role: "moderator",
          evening: {
            slug: "2026-10-03-hack-day",
            name: "Hack day",
            topic: "hack day",
            status: "live",
            startsAt: at("2026-10-03T16:00:00Z"),
          },
        },
        {
          kind: "talk",
          title: "Server components",
          role: "speaker",
          evening: {
            slug: "2026-08-12-react-at-acme",
            name: "React at Acme",
            topic: "react",
            status: "past",
            startsAt: at("2026-08-13T01:00:00Z"),
          },
        },
        {
          kind: "talk",
          title: "Server components",
          role: "speaker",
          evening: {
            slug: "2025-12-02-café-night",
            name: "Café night",
            topic: "café night",
            status: "past",
            startsAt: at("2025-12-03T02:00:00Z"),
          },
        },
      ],
    });
    const zed = speakers.find((person) => person.name === "Zed Nobody");
    expect(zed?.parts[0]).toMatchObject({ kind: "talk", role: "panelist" });
  });

  test("leaves out what a profile leaves empty", async () => {
    const { speakers } = await read();
    expect(
      speakers.find((person) => person.name === "Zed Nobody"),
    ).toMatchObject({
      title: null,
      bio: null,
      links: { x: null, bluesky: null, linkedin: null },
      photo: null,
    });
  });

  test("never lists a draft's people, or anyone who took no part", async () => {
    const { organizers, speakers, coHosts } = await read();
    const everyone = names([...organizers, ...speakers, ...coHosts]);
    expect(everyone).not.toContain("Draft Only");
    expect(everyone).not.toContain("Draft Host");
    expect(names(speakers)).not.toContain("Unattached");
    expect(new Set(everyone).size).toBe(everyone.length);
  });

  test("lists only who was on stage at our evenings, never one we only share", async () => {
    const shared = await seededDatabase();
    try {
      const before = await readFrom(shared, []);
      await shared.exec(`
        INSERT INTO sponsors (id, name, about, updated_at) VALUES
          ('c0000000-0000-4000-8000-000000000900', 'Mastra', 'Agents.', now());
        UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
          WHERE slug = '2026-08-12-react-at-acme';`);
      const after = await readFrom(shared, []);
      const parts = (view: typeof before) =>
        view.speakers.flatMap((person) =>
          person.parts.map((part) => part.evening.slug),
        );
      expect(parts(before)).toContain("2026-08-12-react-at-acme");
      expect(parts(after)).not.toContain("2026-08-12-react-at-acme");
    } finally {
      await shared.close();
    }
  });

  test("shows a photo only from the photo origin", async () => {
    const database = await seededDatabase();
    try {
      await database.exec(
        `UPDATE images SET url = 'https://elsewhere.example/ada.jpg' WHERE id = 'd0000000-0000-4000-8000-000000000005'`,
      );
      const view = await readFrom(database, []);
      expect(view.organizers).toEqual([]);
      expect(
        view.speakers.find((person) => person.name === "Ada Lovelace")?.photo,
      ).toBeNull();
    } finally {
      await database.close();
    }
  });

  test("fails as a DataSourceError when the database can't be read", async () => {
    const database = await seededDatabase();
    await database.close();
    const flipped = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          PeopleDirectory.use((repository) =>
            repository.read([grace], photoOrigin),
          ),
          PeopleDirectory.layer.pipe(
            Layer.provideMerge(sqlLayer(database)),
            Layer.provideMerge(clockAt(now)),
          ),
        ),
      ),
    );
    expect(flipped).toBeInstanceOf(DataSourceError);
  });
});

describe("toPeople", () => {
  const row = (
    id: string,
    name: string,
    starts: ReadonlyArray<string>,
    overrides: Partial<PersonRow> = {},
  ): PersonRow => ({
    id,
    name,
    title: "  ",
    bio: "",
    twitterHandle: null,
    blueskyHandle: null,
    linkedinHandle: null,
    photo: null,
    organizes: false,
    talks: starts.map((start) => ({
      title: "A talk",
      format: "talk",
      role: "speaker",
      slug: `evening-${start}`,
      name: "All Things Web",
      topic: null,
      startDate: DateTime.makeUnsafe(start),
      endDate: DateTime.makeUnsafe(start),
    })),
    roles: [],
    ...overrides,
  });

  test("breaks ties in the latest part by name, then by id", () => {
    const view = toPeople(
      [
        row("3", "Bea", ["2025-01-01T00:00:00Z"]),
        row("2", "Ann", ["2025-01-01T00:00:00Z", "2024-01-01T00:00:00Z"]),
        row("1", "Ann", ["2024-06-01T00:00:00Z", "2025-01-01T00:00:00Z"]),
        row("4", "Cal", ["2026-01-01T00:00:00Z"]),
      ],
      [],
      now,
    );
    expect(view.speakers.map((person) => person.id)).toEqual([
      "4",
      "1",
      "2",
      "3",
    ]);
    // Blank text reads as unknown.
    expect(view.speakers[0]?.title).toBeNull();
  });

  test("skips an organizer asked for whose profile is gone, and lists each person once", () => {
    const view = toPeople(
      [
        row("1", "Ann", []),
        row("2", "Bo", ["2025-01-01T00:00:00Z"], { organizes: true }),
      ],
      ["missing", "1", "2"],
      now,
    );
    expect(view.organizers.map((person) => person.id)).toEqual(["1", "2"]);
    expect(view.speakers).toEqual([]);
  });
});

describe("shortBio", () => {
  test.each([
    [
      "Dan is a DevRel Lead at Vapi and co-hosts the NextDev.fm podcast. He lives in SF.",
      "Dan is a DevRel Lead at Vapi and co-hosts the NextDev.fm podcast.",
    ],
    // A first sentence too short to say much takes the next one with it.
    [
      "Hello! My name is Erik Hanchett! I'm a developer and author from Reno, NV. Currently I work at AWS.",
      "Hello! My name is Erik Hanchett! I'm a developer and author from Reno, NV.",
    ],
    // Abbreviations and dots inside words end no sentence.
    [
      "Dr. Ada works on Next.js at Vercel, Inc. and e.g. writes compilers all day long. She also teaches.",
      "Dr. Ada works on Next.js at Vercel, Inc. and e.g. writes compilers all day long.",
    ],
    ["Writes compilers.", "Writes compilers."],
    [
      "A bio without a second sentence, however long it runs on and on and on",
      "A bio without a second sentence, however long it runs on and on and on",
    ],
    [
      "Ändert Dinge seit Jahren mit großer Freude an der Arbeit im Web! Über Remix.",
      "Ändert Dinge seit Jahren mit großer Freude an der Arbeit im Web!",
    ],
  ])("%j is %j", (bio, short) => {
    expect(shortBio(bio)).toBe(short);
  });
});

describe("toPerson", () => {
  test("reads zero-width and blank space around a bio as nothing", () => {
    const person = toPerson(
      {
        id: "1",
        name: "Daniel",
        title: "​",
        bio: "​Daniel is a Staff Software Engineer. ",
        twitterHandle: null,
        blueskyHandle: null,
        linkedinHandle: null,
        photo: null,
        organizes: false,
        talks: [],
        roles: [],
      },
      now,
    );
    expect(person.title).toBeNull();
    expect(person.bio).toBe("Daniel is a Staff Software Engineer.");
  });
});
