import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { DataSourceError } from "../src/errors.ts";
import {
  People,
  type PeopleView,
  type PersonRow,
  shortBio,
  toPeople,
  toPerson,
} from "../src/people.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * People against the migrated production schema and tests/seed.sql. Grace
 * Hopper (who spoke) and Unattached (who never did) stand in for the
 * organizers.
 */

const grace = "b0000000-0000-4000-8000-000000000002";
const unattached = "b0000000-0000-4000-8000-000000000007";
const photoOrigin = "https://storage.example";

const db = await seededDatabase();
afterAll(() => db.close());

const read = (
  organizerIds: ReadonlyArray<string> = [grace, unattached],
  at: DateTime.Utc = now,
): Promise<PeopleView> =>
  Effect.runPromise(
    Effect.provide(
      People.use((repository) => repository.read(organizerIds, photoOrigin)),
      People.layer.pipe(
        Layer.provideMerge(sqlLayer(db)),
        Layer.provideMerge(clockAt(at)),
      ),
    ),
  );

const names = (people: ReadonlyArray<{ readonly name: string }>) =>
  people.map((person) => person.name);

describe("People", () => {
  test("puts the organizers first, in the order asked for, talks or not", async () => {
    const { organizers } = await read();
    expect(names(organizers)).toEqual(["Grace Hopper", "Unattached"]);
    expect(organizers[1]).toEqual({
      id: unattached,
      name: "Unattached",
      title: "Lurker",
      bio: "No talks yet.",
      links: { x: null, bluesky: null, linkedin: null },
      photo: null,
      talks: [],
    });
    expect(names((await read([unattached, grace])).organizers)).toEqual([
      "Unattached",
      "Grace Hopper",
    ]);
  });

  test("lists every other speaker, whoever spoke or speaks latest first", async () => {
    const { speakers } = await read();
    // Future Speaker's evening is ahead; Ada speaks at the live hack day,
    // after Zed's evening started; Linus last spoke in August.
    expect(names(speakers)).toEqual([
      "Future Speaker",
      "Ada Lovelace",
      "Zed Nobody",
      "Linus",
    ]);
  });

  test("lists organizers' talks with them, not again among the speakers", async () => {
    const { organizers, speakers } = await read();
    expect(names(speakers)).not.toContain("Grace Hopper");
    expect(
      organizers[0]?.talks.map((talk) => [talk.title, talk.evening.slug]),
    ).toEqual([
      ["Server components", "2026-08-12-react-at-acme"],
      ["Server components", "2025-12-02-café-night"],
    ]);
  });

  test("lists each speaker's talks latest first, with each evening as lists name it", async () => {
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
      },
      talks: [
        {
          title: "Hacking live",
          evening: {
            slug: "2026-10-03-hack-day",
            name: "Hack day",
            topic: "hack day",
            status: "live",
            startsAt: DateTime.makeUnsafe("2026-10-03T16:00:00Z"),
          },
        },
        {
          title: "Server components",
          evening: {
            slug: "2026-08-12-react-at-acme",
            name: "React at Acme",
            topic: "react",
            status: "past",
            startsAt: DateTime.makeUnsafe("2026-08-13T01:00:00Z"),
          },
        },
        {
          title: "Server components",
          evening: {
            slug: "2025-12-02-café-night",
            name: "Café night",
            topic: "café night",
            status: "past",
            startsAt: DateTime.makeUnsafe("2025-12-03T02:00:00Z"),
          },
        },
      ],
    });
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

  test("never lists a draft's speaker or anyone without a talk", async () => {
    const { speakers } = await read();
    expect(names(speakers)).not.toContain("Draft Only");
    expect(names(speakers)).not.toContain("Unattached");
  });

  test("shows a photo only from the photo origin", async () => {
    const database = await seededDatabase();
    try {
      await database.exec(
        `UPDATE images SET url = 'https://elsewhere.example/ada.jpg' WHERE id = 'd0000000-0000-4000-8000-000000000005'`,
      );
      const view = await Effect.runPromise(
        Effect.provide(
          People.use((repository) => repository.read([], photoOrigin)),
          People.layer.pipe(
            Layer.provideMerge(sqlLayer(database)),
            Layer.provideMerge(clockAt(now)),
          ),
        ),
      );
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
    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          People.use((repository) => repository.read([grace], photoOrigin)),
          People.layer.pipe(
            Layer.provideMerge(sqlLayer(database)),
            Layer.provideMerge(clockAt(now)),
          ),
        ),
      ),
    );
    expect(failure).toBeInstanceOf(DataSourceError);
  });
});

describe("toPeople", () => {
  const row = (
    id: string,
    name: string,
    starts: ReadonlyArray<string>,
  ): PersonRow => ({
    id,
    name,
    title: "  ",
    bio: "",
    twitterHandle: null,
    blueskyHandle: null,
    linkedinHandle: null,
    photo: null,
    talks: starts.map((start) => ({
      title: "A talk",
      slug: `evening-${start}`,
      name: "All Things Web",
      topic: null,
      startDate: DateTime.makeUnsafe(start),
      endDate: DateTime.makeUnsafe(start),
    })),
  });

  test("breaks ties in the latest talk by name, then by id", () => {
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

  test("skips an organizer whose profile is gone", () => {
    expect(
      toPeople([row("1", "Ann", [])], ["missing", "1"], now).organizers.map(
        (person) => person.id,
      ),
    ).toEqual(["1"]);
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
        talks: [],
      },
      now,
    );
    expect(person.title).toBeNull();
    expect(person.bio).toBe("Daniel is a Staff Software Engineer.");
  });
});
