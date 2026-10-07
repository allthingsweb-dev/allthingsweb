import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../src/approval.ts";
import {
  changeLines,
  editTalk,
  lineDiff,
  listTalks,
  planTalkEdit,
} from "../src/talk-edits.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Editing a talk (src/talk-edits.ts) against tests/seed.sql's "Server
 * components", given by Grace Hopper and Ada Lovelace at React at Acme and
 * at Café night.
 */

const rsc = "a0000000-0000-4000-8000-000000000001";
const ada = "b0000000-0000-4000-8000-000000000001";
const grace = "b0000000-0000-4000-8000-000000000002";
const linus = "b0000000-0000-4000-8000-000000000003";

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer(db))));

const failure = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(sqlLayer(db)), Effect.flip),
  ) as Promise<{ readonly message: string }>;

const talk = async () =>
  (
    await db.query<{ title: string; description: string }>(
      `SELECT title, description FROM talks WHERE id = $1`,
      [rsc],
    )
  ).rows[0]!;

const speakers = async () =>
  (
    await db.query<{ id: string; role: string }>(
      `SELECT speaker_id AS id, role FROM talk_speakers
       WHERE talk_id = $1 ORDER BY created_at, speaker_id`,
      [rsc],
    )
  ).rows;

const description =
  "<p>Why <strong>RSC</strong> &amp; streaming matter.</p><ul><li>One</li><li>Two</li></ul>";

describe("talks", () => {
  test("lists an evening's talks in page order, with their speakers", async () => {
    const listed = await run(listTalks("2026-08-12-react-at-acme"));
    expect(listed.slug).toBe("2026-08-12-react-at-acme");
    expect(listed.talks.map((one) => one.title)).toEqual([
      "Effect in production",
      "Server components",
    ]);
    expect(listed.talks[1]!.speakers).toEqual([
      {
        id: grace,
        name: "Grace Hopper",
        slug: "grace-hopper",
        role: "speaker",
      },
      { id: ada, name: "Ada Lovelace", slug: "ada-lovelace", role: "speaker" },
    ]);
  });

  test("a dry run says each value as it is and will be, with its token, and changes nothing", async () => {
    const { change, token } = await run(
      planTalkEdit(rsc, {
        title: "  Server components in practice ",
        speakers: [
          { profile: "ada-lovelace", role: "speaker" },
          { profile: linus, role: "moderator" },
        ],
      }),
    );
    expect(change).toEqual({
      talk: {
        id: rsc,
        events: ["2025-12-02-café-night", "2026-08-12-react-at-acme"],
      },
      title: {
        from: "Server components",
        to: "Server components in practice",
      },
      description: null,
      speakers: {
        from: [
          {
            id: grace,
            name: "Grace Hopper",
            slug: "grace-hopper",
            role: "speaker",
          },
          {
            id: ada,
            name: "Ada Lovelace",
            slug: "ada-lovelace",
            role: "speaker",
          },
        ],
        to: [
          {
            id: ada,
            name: "Ada Lovelace",
            slug: "ada-lovelace",
            role: "speaker",
          },
          { id: linus, name: "Linus", slug: "linus", role: "moderator" },
        ],
      },
    });
    expect(token).toBe(await Effect.runPromise(approvalToken(change)));
    expect(changeLines(change)).toEqual([
      `talk ${rsc}, on 2025-12-02-café-night, 2026-08-12-react-at-acme`,
      "title:",
      '- "Server components"',
      '+ "Server components in practice"',
      "description: unchanged",
      "speakers, in order:",
      "- Grace Hopper (grace-hopper, speaker)",
      "  Ada Lovelace (ada-lovelace, speaker)",
      "+ Linus (linus, moderator)",
    ]);
    expect((await talk()).title).toBe("Server components");
    expect(await speakers()).toEqual([
      { id: grace, role: "speaker" },
      { id: ada, role: "speaker" },
    ]);
  });

  test("makes the approved change: the title, the description, and the speakers in the order given", async () => {
    const edit = {
      title: "Server components in practice",
      description: "<p>Streaming, live.</p>",
      speakers: [
        { profile: "ada-lovelace", role: "speaker" as const },
        { profile: "grace-hopper", role: "moderator" as const },
      ],
    };
    const { change, token } = await run(planTalkEdit(rsc, edit));
    expect(await run(editTalk(rsc, edit, token))).toEqual(change);
    expect(await talk()).toEqual({
      title: "Server components in practice",
      description: "<p>Streaming, live.</p>",
    });
    expect(await speakers()).toEqual([
      { id: ada, role: "speaker" },
      { id: grace, role: "moderator" },
    ]);
  });

  test("leaves out what doesn't change, and says when nothing does", async () => {
    const { change } = await run(
      planTalkEdit(rsc, {
        title: "Server components",
        description,
        speakers: [
          { profile: "grace-hopper", role: "speaker" },
          { profile: ada, role: "speaker" },
        ],
      }),
    );
    expect(change).toMatchObject({
      title: null,
      description: null,
      speakers: null,
    });
  });

  test("refuses when the talk changed since the dry run, and changes nothing", async () => {
    const edit = { title: "Server components in practice" };
    const { token } = await run(planTalkEdit(rsc, edit));
    await db.query(
      `UPDATE talk_speakers SET role = 'moderator' WHERE talk_id = $1 AND speaker_id = $2`,
      [rsc, ada],
    );
    // The title alone would still hash the same: the speakers aren't edited.
    expect((await run(planTalkEdit(rsc, edit))).token).toBe(token);
    await db.query(`UPDATE talks SET title = 'Renamed' WHERE id = $1`, [rsc]);
    const error = await failure(editTalk(rsc, edit, token));
    expect(error.message).toStartWith(
      `The change has changed since ${token} was approved: it is now `,
    );
    expect((await talk()).title).toBe("Renamed");
  });

  test("refuses a speaker list that changed since the dry run", async () => {
    const edit = { speakers: [{ profile: "linus", role: "speaker" as const }] };
    const { token } = await run(planTalkEdit(rsc, edit));
    await db.query(
      `INSERT INTO talk_speakers (talk_id, speaker_id, role, updated_at) VALUES ($1, $2, 'speaker', now())`,
      [rsc, linus],
    );
    const error = await failure(editTalk(rsc, edit, token));
    expect(error.message).toContain("has changed since");
    expect(await speakers()).toHaveLength(3);
  });

  test.each([
    [{}, "Nothing to change: give a new title, description or speakers."],
    [{ title: "  " }, "A talk's title can't be empty."],
    [{ speakers: [] }, "A talk needs at least one speaker."],
    [
      { speakers: [{ profile: "nobody", role: "speaker" as const }] },
      "No profile is nobody: give a speaker's slug (as /people/<slug> has it) or id.",
    ],
    [
      {
        speakers: [
          { profile: "linus", role: "speaker" as const },
          { profile: linus, role: "moderator" as const },
        ],
      },
      "Linus is named twice.",
    ],
  ])("refuses %j", async (edit, message) => {
    expect((await failure(planTalkEdit(rsc, edit))).message).toBe(message);
  });

  test("refuses a talk that isn't there, and a token that isn't one", async () => {
    expect(
      (
        await failure(
          planTalkEdit("a0000000-0000-4000-8000-000000000099", { title: "x" }),
        )
      ).message,
    ).toBe("No talk has the id a0000000-0000-4000-8000-000000000099.");
    expect((await failure(planTalkEdit("rsc", { title: "x" }))).message).toBe(
      "rsc is not a talk's id.",
    );
    expect((await failure(editTalk(rsc, { title: "x" }, "yes"))).message).toBe(
      "yes is not an approval token: give the one talks update --dry-run printed.",
    );
  });
});

describe("lineDiff", () => {
  test("keeps what is common, and takes out and puts in the rest, in order", () => {
    expect(lineDiff("a\nb\nc", "a\nc\nd")).toEqual([
      "  a",
      "- b",
      "  c",
      "+ d",
    ]);
    expect(lineDiff("", "new")).toEqual(["+ new"]);
    expect(lineDiff("old", "")).toEqual(["- old"]);
    expect(lineDiff("<p>one</p>", "<p>two</p>")).toEqual([
      "- <p>one</p>",
      "+ <p>two</p>",
    ]);
  });
});
