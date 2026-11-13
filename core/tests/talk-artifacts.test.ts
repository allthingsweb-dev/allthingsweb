import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { artifactsOf } from "../src/catalog.ts";
import {
  applyTalkArtifacts,
  ArtifactRow,
  artifactJson,
  decodeTalkArtifactsFile,
  fileProblems,
  playAt,
  type TalkArtifactsFile,
  TalkArtifactsError,
  talkLinks,
} from "../src/talk-artifacts.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * What talks left behind: applying a sourced file on tests/seed.sql,
 * reading a talk's links back as every surface does, the talk's own
 * recording among them, and the file this branch carries.
 */

const server = "a0000000-0000-4000-8000-000000000001";
const effect = "a0000000-0000-4000-8000-000000000002";
const source = "https://www.youtube.com/watch?v=evening";
const read = "2026-11-13";

const file: TalkArtifactsFile = {
  artifacts: [
    {
      talkId: server,
      title: "Server components",
      kind: "recording",
      url: "https://www.youtube.com/watch?v=evening",
      startSeconds: 385,
      source,
      read,
    },
    {
      talkId: server,
      title: "Server components",
      kind: "slides",
      url: "https://speakerdeck.com/ada/rsc",
      source: "https://ada.example/talks",
      read,
    },
    {
      talkId: server,
      title: "Server components",
      kind: "recording",
      url: "https://www.youtube.com/watch?v=conf",
      label: "The same talk, longer",
      elsewhere: "React Conf 2025",
      source: "https://www.youtube.com/watch?v=conf",
      read,
    },
    {
      talkId: effect,
      title: "Effect in production",
      kind: "repo",
      url: "https://github.com/grace/effect-demo",
      label: "The demo",
      source: "https://github.com/grace/effect-demo",
      read,
    },
  ],
  held: [
    {
      talkId: effect,
      title: "Effect in production",
      kind: "slides",
      url: "https://example.com/maybe",
      question: "Are these the slides from that night?",
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

const apply = (db: PGlite, artifacts: TalkArtifactsFile, dryRun = false) =>
  Effect.runPromiseExit(
    applyTalkArtifacts(artifacts, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const stored = async (db: PGlite) =>
  (
    await db.query<Record<string, unknown>>(
      `SELECT talk_id, kind, url, label, start_seconds, elsewhere, position
       FROM talk_artifacts ORDER BY talk_id, position`,
    )
  ).rows;

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  const error = Exit.isFailure(exit)
    ? exit.cause.reasons
        .map((part) => ("error" in part ? part.error : undefined))
        .find((e) => e !== undefined)
    : undefined;
  expect(error).toBeInstanceOf(TalkArtifactsError);
  return (error as TalkArtifactsError).reason;
};

describe("applyTalkArtifacts", () => {
  test("adds each link in its talk's order, never a held one, and says so", async () => {
    const db = await fresh();
    const exit = await apply(db, file);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      'held: "Effect in production": slides https://example.com/maybe',
      '"Server components": recording https://www.youtube.com/watch?v=evening: added',
      '"Server components": slides https://speakerdeck.com/ada/rsc: added',
      '"Server components": recording https://www.youtube.com/watch?v=conf: added',
      '"Effect in production": repo https://github.com/grace/effect-demo: added',
    ]);
    expect(await stored(db)).toEqual([
      {
        talk_id: server,
        kind: "recording",
        url: "https://www.youtube.com/watch?v=evening",
        label: null,
        start_seconds: 385,
        elsewhere: null,
        position: 0,
      },
      {
        talk_id: server,
        kind: "slides",
        url: "https://speakerdeck.com/ada/rsc",
        label: null,
        start_seconds: null,
        elsewhere: null,
        position: 1,
      },
      {
        talk_id: server,
        kind: "recording",
        url: "https://www.youtube.com/watch?v=conf",
        label: "The same talk, longer",
        start_seconds: null,
        elsewhere: "React Conf 2025",
        position: 2,
      },
      {
        talk_id: effect,
        kind: "repo",
        url: "https://github.com/grace/effect-demo",
        label: "The demo",
        start_seconds: null,
        elsewhere: null,
        position: 0,
      },
    ]);
  });

  test("is safe to repeat, takes a corrected start, and keeps links from elsewhere", async () => {
    const db = await fresh();
    await apply(db, file);
    await db.exec(
      `INSERT INTO talk_artifacts (talk_id, kind, url, position, updated_at)
       VALUES ('${effect}', 'site', 'https://grace.example/demo', 5, now())`,
    );
    const again = await apply(db, file);
    expect(
      Exit.isSuccess(again)
        ? again.value.filter((line) => !line.startsWith("held"))
        : again,
    ).toEqual([
      '"Server components": recording https://www.youtube.com/watch?v=evening: already there',
      '"Server components": slides https://speakerdeck.com/ada/rsc: already there',
      '"Server components": recording https://www.youtube.com/watch?v=conf: already there',
      '"Effect in production": repo https://github.com/grace/effect-demo: already there',
    ]);
    const [first, ...rest] = file.artifacts;
    if (first === undefined) throw new Error("fixture");
    const corrected = await apply(db, {
      ...file,
      artifacts: [{ ...first, startSeconds: 390 }, ...rest],
    });
    expect(Exit.isSuccess(corrected) ? corrected.value[1] : corrected).toBe(
      '"Server components": recording https://www.youtube.com/watch?v=evening: updated',
    );
    expect(await stored(db)).toHaveLength(5);
  });

  test("a dry run reports everything and writes nothing", async () => {
    const db = await fresh();
    const exit = await apply(db, file, true);
    expect(Exit.isSuccess(exit) ? exit.value.at(-1) : exit).toBe(
      "Dry run: rolled back.",
    );
    expect(await stored(db)).toEqual([]);
  });

  test("writes nothing for an unknown talk, a stale title, a link twice, a start on slides, or two recordings of its own", async () => {
    const db = await fresh();
    const [own, slides] = file.artifacts;
    if (own === undefined || slides === undefined) throw new Error("fixture");
    for (const [artifacts, reason] of [
      [
        [{ ...own, talkId: "a0000000-0000-4000-8000-000000000099" }],
        "No talk has the id a0000000-0000-4000-8000-000000000099.",
      ],
      [
        [{ ...own, title: "Client components" }],
        `Talk ${server} is titled "Server components", not "Client components".`,
      ],
      [
        [slides, slides],
        `"Server components" lists ${slides.url} more than once.`,
      ],
      [
        [{ ...slides, startSeconds: 10 }],
        `"Server components": ${slides.url} has a start but is a slides, not a recording.`,
      ],
      [
        [own, { ...own, url: "https://www.youtube.com/watch?v=other" }],
        '"Server components" has more than one recording of its own; mark the others with where they were given (elsewhere).',
      ],
    ] as const) {
      expect(failure(await apply(db, { artifacts, held: [] }))).toBe(reason);
    }
    expect(await stored(db)).toEqual([]);
  });

  test("refuses a second recording of a talk's own beside one another source added", async () => {
    const db = await fresh();
    await db.exec(
      `INSERT INTO talk_artifacts (talk_id, kind, url, position, updated_at)
       VALUES ('${server}', 'recording', 'https://www.youtube.com/watch?v=room', 0, now())`,
    );
    const [own] = file.artifacts;
    if (own === undefined) throw new Error("fixture");
    expect(failure(await apply(db, { artifacts: [own], held: [] }))).toBe(
      'These talks would have more than one recording of their own: "Server components".',
    );
    expect(await stored(db)).toHaveLength(1);
  });

  test("the database refuses a link that isn't https, an unknown kind, a start on slides, and a source without its day", async () => {
    const db = await fresh();
    for (const statement of [
      `INSERT INTO talk_artifacts (talk_id, kind, url, position, updated_at)
       VALUES ('${server}', 'slides', 'http://insecure.example', 0, now())`,
      `INSERT INTO talk_artifacts (talk_id, kind, url, position, updated_at)
       VALUES ('${server}', 'video', 'https://v.example', 0, now())`,
      `INSERT INTO talk_artifacts (talk_id, kind, url, start_seconds, position, updated_at)
       VALUES ('${server}', 'slides', 'https://s.example', 10, 0, now())`,
      `INSERT INTO talk_artifacts (talk_id, kind, url, position, source_url, updated_at)
       VALUES ('${server}', 'slides', 'https://s.example', 0, 'https://found.example', now())`,
    ]) {
      await expect(db.exec(statement)).rejects.toThrow(
        /violates check constraint/,
      );
    }
  });

  test("a talk's links go with it", async () => {
    const db = await fresh();
    await apply(db, file);
    await db.exec(`DELETE FROM talk_speakers WHERE talk_id = '${effect}'`);
    await db.exec(`DELETE FROM event_talks WHERE talk_id = '${effect}'`);
    await db.exec(`DELETE FROM talks WHERE id = '${effect}'`);
    expect(
      (await stored(db)).filter((row) => row["talk_id"] === effect),
    ).toEqual([]);
  });
});

describe("a talk's links, as surfaces read them", () => {
  const linksOf = (db: PGlite, talkId: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient;
        const find = SqlSchema.findOneOption({
          Request: Schema.String,
          Result: Schema.Struct({ artifacts: Schema.Array(ArtifactRow) }),
          execute: (id) => sql`
            SELECT ${artifactsOf(sql, artifactJson(sql))} AS artifacts
            FROM talks t WHERE t.id = ${id}::uuid`,
        });
        return yield* find(talkId);
      }).pipe(Effect.provide(sqlLayer(db))),
    );

  test("the title's recording is the first of its own, from the talk's start; the rest follow in order", async () => {
    const db = await fresh();
    await apply(db, file);
    const row = await linksOf(db, server);
    if (row._tag !== "Some") throw new Error("talk");
    expect(talkLinks(row.value.artifacts)).toEqual({
      recording: {
        url: "https://www.youtube.com/watch?v=evening&t=385",
        startSeconds: 385,
      },
      artifacts: [
        {
          kind: "slides",
          url: "https://speakerdeck.com/ada/rsc",
          label: null,
          elsewhere: null,
        },
        {
          kind: "recording",
          url: "https://www.youtube.com/watch?v=conf",
          label: "The same talk, longer",
          elsewhere: "React Conf 2025",
        },
      ],
    });
  });

  test("a talk with no links has neither", async () => {
    const db = await fresh();
    const row = await linksOf(db, effect);
    if (row._tag !== "Some") throw new Error("talk");
    expect(talkLinks(row.value.artifacts)).toEqual({
      recording: null,
      artifacts: [],
    });
  });

  test("a recording only from elsewhere is a link, not the title's", () => {
    expect(
      talkLinks([
        {
          kind: "recording",
          url: "https://www.youtube.com/watch?v=conf",
          label: null,
          startSeconds: null,
          elsewhere: "React Conf 2025",
        },
      ]).recording,
    ).toBeNull();
  });
});

describe("playAt", () => {
  test("starts YouTube at its t parameter and Vimeo at its #t, and leaves others", () => {
    expect(playAt("https://www.youtube.com/watch?v=abc", 2890)).toBe(
      "https://www.youtube.com/watch?v=abc&t=2890",
    );
    expect(playAt("https://youtu.be/abc", 60)).toBe(
      "https://youtu.be/abc?t=60",
    );
    expect(playAt("https://www.youtube.com/watch?v=abc&t=10", 60)).toBe(
      "https://www.youtube.com/watch?v=abc&t=60",
    );
    expect(playAt("https://vimeo.com/123", 90)).toBe(
      "https://vimeo.com/123#t=90s",
    );
    expect(playAt("https://media.example/talk.mp4", 90)).toBe(
      "https://media.example/talk.mp4",
    );
    expect(playAt("https://www.youtube.com/watch?v=abc", 0)).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
    expect(playAt("https://www.youtube.com/watch?v=abc", null)).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
  });
});

describe("decodeTalkArtifactsFile", () => {
  const decodes = async (value: unknown) =>
    Exit.isSuccess(
      await Effect.runPromiseExit(
        decodeTalkArtifactsFile(JSON.stringify(value)),
      ),
    );
  const [first] = file.artifacts;

  test("refuses an unknown field, an unknown kind, an impossible day, a link that isn't https, a negative start and an empty label", async () => {
    expect(await decodes(file)).toBe(true);
    for (const artifact of [
      { ...first, venue: "Somewhere" },
      { ...first, kind: "video" },
      { ...first, read: "2025-02-30" },
      { ...first, url: "http://www.youtube.com/watch?v=evening" },
      { ...first, startSeconds: -1 },
      { ...first, startSeconds: 1.5 },
      { ...first, label: "" },
      { ...first, elsewhere: " React Conf" },
    ]) {
      expect(await decodes({ artifacts: [artifact], held: [] })).toBe(false);
    }
  });

  test("the file this branch carries decodes and has no problems", async () => {
    const text = await Bun.file(
      new URL("../backfill/talk-artifacts.json", import.meta.url),
    ).text();
    const decoded = await Effect.runPromise(decodeTalkArtifactsFile(text));
    expect(fileProblems(decoded)).toEqual([]);
  });
});
