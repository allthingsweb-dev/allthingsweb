import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Schema } from "effect";
import {
  applyLineups,
  LineupError,
  Lineups,
  undefinedPeople,
} from "../src/lineups.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Applying researched lineups: against tests/seed.sql, and the file this
 * branch carries, which must decode and name only people it defines.
 */

const source = ["https://luma.com/example"];

const lineups: Lineups = {
  people: {
    grace: {
      profileId: "b0000000-0000-4000-8000-000000000002",
      // Grace has a title, so only the handle and photo are filled in.
      fill: {
        title: "Not written",
        twitterHandle: "grace",
        photoSourceUrl: "https://avatars.githubusercontent.com/u/2",
      },
      sources: source,
    },
    ada: { profileId: "b0000000-0000-4000-8000-000000000001", sources: source },
    kay: {
      create: {
        name: "Kay Newperson",
        title: "Engineer",
        bio: "",
        twitterHandle: "kay",
        blueskyHandle: null,
        linkedinHandle: null,
        photoSourceUrl: "https://avatars.githubusercontent.com/u/1",
      },
      sources: source,
    },
    linus: {
      create: {
        name: "Linus",
        title: "",
        bio: "",
        twitterHandle: null,
        blueskyHandle: null,
        linkedinHandle: null,
        photoSourceUrl: null,
      },
      sources: source,
    },
  },
  events: [
    {
      lumaEventId: "evt-react",
      name: "React at Acme",
      // React at Acme already links its recording.
      recordingUrl: "https://www.youtube.com/watch?v=other",
      talks: [
        {
          title: "A fireside",
          format: "fireside",
          description: "",
          speakers: [
            { person: "kay", role: "speaker" },
            { person: "ada", role: "moderator" },
          ],
          sources: source,
          confidence: "high",
        },
        {
          title: "effect in production",
          format: "talk",
          description: "Already there, by title.",
          speakers: [{ person: "linus", role: "speaker" }],
          sources: source,
          confidence: "medium",
        },
      ],
      people: [{ person: "ada", role: "mc", sources: source }],
    },
  ],
};

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

const database = async () => {
  const db = await seededDatabase();
  opened.push(db);
  return db;
};

const apply = (db: PGlite, input: Lineups, dryRun = false) =>
  Effect.runPromiseExit(
    applyLineups(input, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const state = async (db: PGlite) => ({
  talks: (
    await db.query(`
      SELECT t.title, t.format, string_agg(p.name || ' ' || ts.role, ', ' ORDER BY ts.created_at) AS speakers
      FROM event_talks et JOIN talks t ON t.id = et.talk_id
      LEFT JOIN talk_speakers ts ON ts.talk_id = t.id
      LEFT JOIN profiles p ON p.id = ts.speaker_id
      WHERE et.event_id = 'e0000000-0000-4000-8000-000000000001'
      GROUP BY t.id, t.title, t.format, et.created_at
      ORDER BY et.created_at, t.id`)
  ).rows,
  people: (
    await db.query(
      `SELECT p.name, ep.role, ep.position, ep.source FROM event_people ep JOIN profiles p ON p.id = ep.profile_id ORDER BY ep.role, ep.position`,
    )
  ).rows,
  profiles: (await db.query(`SELECT count(*)::int AS n FROM profiles`)).rows,
  grace: (
    await db.query(
      `SELECT title, twitter_handle, photo_source_url FROM profiles WHERE id = 'b0000000-0000-4000-8000-000000000002'`,
    )
  ).rows,
  recording: (
    await db.query(
      `SELECT recording_url FROM events WHERE id = 'e0000000-0000-4000-8000-000000000001'`,
    )
  ).rows,
});

describe("applying lineups", () => {
  test("adds talks, speakers with roles, people and new profiles", async () => {
    const db = await database();
    const exit = await apply(db, lineups);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((await state(db)).talks).toEqual([
      {
        title: "Effect in production",
        format: "talk",
        speakers: "Linus speaker",
      },
      {
        title: "Server components",
        format: "talk",
        speakers: "Grace Hopper speaker, Ada Lovelace speaker",
      },
      {
        title: "A fireside",
        format: "fireside",
        speakers: "Kay Newperson speaker, Ada Lovelace moderator",
      },
    ]);
    expect((await state(db)).grace).toEqual([
      {
        title: "Admiral",
        twitter_handle: "grace",
        photo_source_url: "https://avatars.githubusercontent.com/u/2",
      },
    ]);
    expect((await state(db)).recording).toEqual([
      { recording_url: "https://www.youtube.com/watch?v=abc123" },
    ]);
    expect((await state(db)).people).toEqual([
      { name: "Ada Lovelace", role: "mc", position: 0, source: "site" },
    ]);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.lines).toEqual([
        "profile Grace Hopper: filled in",
        expect.stringMatching(/^profile Kay Newperson: created \(/),
        expect.stringMatching(
          /^profile Linus: exists \(b0000000-.*\), reused$/,
        ),
        "evt-react React at Acme",
        "  recording: already set",
        '  talk "A fireside" (fireside): kay speaker, ada moderator',
        '  talk "effect in production": already as written',
        "  mc ada: added",
      ]);
    }
  });

  test("a second run changes nothing", async () => {
    const db = await database();
    await apply(db, lineups);
    const before = await state(db);
    expect(Exit.isSuccess(await apply(db, lineups))).toBe(true);
    expect(await state(db)).toEqual(before);
  });

  test("a dry run does everything, then rolls back", async () => {
    const db = await database();
    const before = await state(db);
    const exit = await apply(db, lineups, true);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.lines.at(-1)).toBe("Dry run: rolled back.");
      expect(exit.value.lines).toContain("  mc ada: added");
    }
    expect(await state(db)).toEqual(before);
  });

  test.each([
    [
      "an unknown event",
      {
        ...lineups,
        events: [{ ...lineups.events[0]!, lumaEventId: "evt-none" }],
      },
      "No event has the Luma id evt-none",
    ],
    [
      "an unknown profile",
      {
        ...lineups,
        people: {
          ...lineups.people,
          ada: {
            profileId: "b0000000-0000-4000-8000-0000000000ff",
            sources: source,
          },
        },
      },
      "ada: no profile b0000000-0000-4000-8000-0000000000ff",
    ],
    [
      "a person the file doesn't define",
      { ...lineups, people: { kay: lineups.people["kay"]! } },
      "People not defined in the file: ada, linus",
    ],
  ] as const)("%s writes nothing", async (_, input, reason) => {
    const db = await database();
    const before = await state(db);
    const exit = await apply(db, input);
    expect(exit).toEqual(Exit.fail(new LineupError({ reason })));
    expect(await state(db)).toEqual(before);
  });
});

describe("core/backfill/lineups.json", () => {
  test("decodes, and names only people it defines", async () => {
    const text = await Bun.file(
      new URL("../backfill/lineups.json", import.meta.url),
    ).text();
    const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(Lineups))(
      text,
    );
    expect(undefinedPeople(decoded)).toEqual([]);
  });
});
