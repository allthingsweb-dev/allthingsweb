import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit } from "effect";
import {
  applyExternalTalks,
  decodeExternalTalksFile,
  type ExternalTalksFile,
  ExternalTalks,
  ExternalTalksError,
} from "../src/external-talks.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Talks given elsewhere: applying a sourced file on tests/seed.sql, reading
 * them back for person pages, and the file this branch carries.
 */

const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const read = "2026-10-05";

const file: ExternalTalksFile = {
  talks: [
    {
      profileId: ada,
      name: "Ada Lovelace",
      title: "Notes on the Analytical Engine",
      eventName: "Royal Society Conf",
      kind: "conference",
      givenOn: "2025-06-10",
      url: "https://conf.example/talks/engine",
      videoUrl: "https://www.youtube.com/watch?v=engine",
      source: "https://conf.example/talks/engine",
      read,
    },
    {
      profileId: ada,
      name: "Ada Lovelace",
      title: "Compilers on air",
      eventName: "Code Radio",
      kind: "podcast",
      givenOn: "2026-02-01",
      url: "https://radio.example/ep/42",
      videoUrl: null,
      source: "https://radio.example/ep/42",
      read,
    },
    {
      profileId: grace,
      name: "Grace Hopper",
      title: "Nanoseconds",
      eventName: "Navy Meetup",
      kind: "meetup",
      givenOn: "2024-03-01",
      url: null,
      videoUrl: "https://www.youtube.com/watch?v=nanos",
      source: "https://www.youtube.com/watch?v=nanos",
      read,
    },
  ],
  held: [
    {
      name: "Grace Hopper",
      title: "Bugs",
      eventName: "Somewhere",
      sources: ["https://example.com/bugs"],
      reason: "date unknown",
    },
  ],
};

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

const fresh = async () => {
  const db = await seededDatabase();
  databases.push(db);
  return db;
};

const apply = (db: PGlite, talks: ExternalTalksFile, dryRun = false) =>
  Effect.runPromiseExit(
    applyExternalTalks(talks, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const stored = async (db: PGlite) =>
  (
    await db.query(
      `SELECT title, event_name, kind, to_char(given_on, 'YYYY-MM-DD') AS given_on, url, video_url
       FROM external_talks ORDER BY given_on`,
    )
  ).rows;

describe("applyExternalTalks", () => {
  test("adds each talk, never a held one, and says so", async () => {
    const db = await fresh();
    const exit = await apply(db, file);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      'held: Grace Hopper: "Bugs": date unknown',
      'Ada Lovelace: "Notes on the Analytical Engine" (Royal Society Conf, 2025-06-10): added',
      'Ada Lovelace: "Compilers on air" (Code Radio, 2026-02-01): added',
      'Grace Hopper: "Nanoseconds" (Navy Meetup, 2024-03-01): added',
    ]);
    expect(await stored(db)).toHaveLength(3);
  });

  test("is safe to repeat, and takes a corrected link on the next run", async () => {
    const db = await fresh();
    await apply(db, file);
    const again = await apply(db, file);
    expect(
      Exit.isSuccess(again)
        ? again.value.filter((l) => !l.startsWith("held"))
        : again,
    ).toEqual([
      'Ada Lovelace: "Notes on the Analytical Engine" (Royal Society Conf, 2025-06-10): already there',
      'Ada Lovelace: "Compilers on air" (Code Radio, 2026-02-01): already there',
      'Grace Hopper: "Nanoseconds" (Navy Meetup, 2024-03-01): already there',
    ]);
    const [first, ...rest] = file.talks;
    if (first === undefined) throw new Error("fixture");
    const corrected = await apply(db, {
      ...file,
      talks: [
        { ...first, videoUrl: "https://www.youtube.com/watch?v=v2" },
        ...rest,
      ],
    });
    expect(Exit.isSuccess(corrected) ? corrected.value[1] : corrected).toBe(
      'Ada Lovelace: "Notes on the Analytical Engine" (Royal Society Conf, 2025-06-10): updated',
    );
  });

  test("a dry run reports everything and writes nothing", async () => {
    const db = await fresh();
    const exit = await apply(db, file, true);
    expect(Exit.isSuccess(exit) ? exit.value.at(-1) : exit).toBe(
      "Dry run: rolled back.",
    );
    expect(await stored(db)).toEqual([]);
  });

  test("writes nothing for an unknown profile, a stale name, or a talk listed twice", async () => {
    const db = await fresh();
    const [first] = file.talks;
    if (first === undefined) throw new Error("fixture");
    for (const [talks, reason] of [
      [
        [{ ...first, profileId: "b0000000-0000-4000-8000-000000000099" }],
        "No profile has the id b0000000-0000-4000-8000-000000000099.",
      ],
      [
        [{ ...first, name: "Ada Byron" }],
        `Profile ${ada} is named "Ada Lovelace", not "Ada Byron".`,
      ],
      [
        [first, first],
        'Talks listed more than once: Ada Lovelace: "Notes on the Analytical Engine" (2025-06-10)',
      ],
    ] as const) {
      const exit = await apply(db, { talks, held: [] });
      const error = Exit.isFailure(exit)
        ? exit.cause.reasons
            .map((part) => ("error" in part ? part.error : undefined))
            .find((e) => e !== undefined)
        : undefined;
      expect(error).toBeInstanceOf(ExternalTalksError);
      expect((error as ExternalTalksError).reason).toBe(reason);
    }
    expect(await stored(db)).toEqual([]);
  });

  test("the database refuses a link that isn't https, and an unknown kind", async () => {
    const db = await fresh();
    for (const statement of [
      `INSERT INTO external_talks (profile_id, title, event_name, kind, given_on, url, source_url, read_on, updated_at)
       VALUES ('${ada}', 'T', 'E', 'talk', '2025-01-01', NULL, 'https://s.example', '2026-10-05', now())`,
      `INSERT INTO external_talks (profile_id, title, event_name, kind, given_on, url, source_url, read_on, updated_at)
       VALUES ('${ada}', 'T', 'E', 'video', '2025-01-01', 'http://insecure.example', 'https://s.example', '2026-10-05', now())`,
    ]) {
      await expect(db.exec(statement)).rejects.toThrow(
        /violates check constraint/,
      );
    }
  });
});

describe("ExternalTalks.forProfiles", () => {
  test("lists each person's talks, latest first", async () => {
    const db = await fresh();
    await apply(db, file);
    const byProfile = await Effect.runPromise(
      ExternalTalks.use((talks) =>
        talks.forProfiles([ada, grace, "b0000000-0000-4000-8000-000000000003"]),
      ).pipe(Effect.provide(ExternalTalks.layer), Effect.provide(sqlLayer(db))),
    );
    expect(
      byProfile.get(ada)?.map((talk) => [talk.title, talk.kind, talk.givenOn]),
    ).toEqual([
      ["Compilers on air", "podcast", "2026-02-01"],
      ["Notes on the Analytical Engine", "conference", "2025-06-10"],
    ]);
    expect(byProfile.get(grace)?.[0]).toEqual({
      profileId: grace,
      title: "Nanoseconds",
      eventName: "Navy Meetup",
      kind: "meetup",
      givenOn: "2024-03-01",
      url: null,
      videoUrl: "https://www.youtube.com/watch?v=nanos",
    });
    // Linus gave none.
    expect(byProfile.has("b0000000-0000-4000-8000-000000000003")).toBe(false);
  });

  test("asks nothing for nobody", async () => {
    const db = await fresh();
    const none = await Effect.runPromise(
      ExternalTalks.use((talks) => talks.forProfiles([])).pipe(
        Effect.provide(ExternalTalks.layer),
        Effect.provide(sqlLayer(db)),
      ),
    );
    expect(none.size).toBe(0);
  });
});

describe("decodeExternalTalksFile", () => {
  const decodes = async (value: unknown) =>
    Exit.isSuccess(
      await Effect.runPromiseExit(
        decodeExternalTalksFile(JSON.stringify(value)),
      ),
    );
  const [first] = file.talks;

  test("refuses an unknown field, an unknown kind, an impossible day, and a link that isn't https", async () => {
    expect(await decodes(file)).toBe(true);
    for (const talk of [
      { ...first, venue: "Somewhere" },
      { ...first, kind: "talk" },
      { ...first, givenOn: "2025-13-01" },
      { ...first, url: "http://conf.example" },
    ]) {
      expect(await decodes({ talks: [talk], held: [] })).toBe(false);
    }
  });

  test("the file this branch carries decodes, each talk once", async () => {
    const text = await Bun.file(
      new URL("../backfill/external-talks.json", import.meta.url),
    ).text();
    const decoded = await Effect.runPromise(decodeExternalTalksFile(text));
    const keys = decoded.talks.map(
      (t) => `${t.profileId} ${t.title} ${t.givenOn}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
