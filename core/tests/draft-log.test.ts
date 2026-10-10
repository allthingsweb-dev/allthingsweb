import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, DateTime, Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Collab } from "../src/collab/collab.ts";
import { rolledBack } from "../src/planning/dry-run.ts";
import { Drafts } from "../src/planning/draft.ts";
import { Planning } from "../src/planning/planning.ts";
import { Readiness } from "../src/readiness/readiness.ts";
import { LumaWrite } from "../src/luma/write.ts";
import { Studio } from "../src/luma/publish.ts";
import { Promo } from "../src/promo/promo.ts";
import { sqlLayer } from "../scripts/pglite.ts";
import { clockAt, seededDatabase, studioLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy } from "./support/luma.ts";

/**
 * A draft's log, notes and status (src/planning/draft-log.ts, draft.ts;
 * migrations/0028_draft_log.ts):
 *
 * - every studio write that touches a draft adds its line in the write's
 *   own transaction: kept with it, rolled back with it, and a failing line
 *   takes the write back with it;
 * - every write says who is writing (ALLTHINGS_ACTOR, which tests/
 *   preload.ts sets to test/core) and refuses without it, before it writes
 *   anything or sends anything to Luma; reads never ask;
 * - the log is append-only and a note is written once, for the owner too;
 * - plan status shows all of a draft, and leaves out what its role can't
 *   read, saying so.
 */

const draft = "2026-09-01-draft-night";
const draftId = "e0000000-0000-4000-8000-000000000002";

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
  // Ahead of the clock, so it takes invitations.
  await db.exec(`UPDATE events SET start_date = '2026-11-18T02:00:00Z',
    end_date = '2026-11-18T05:00:00Z' WHERE id = '${draftId}'`);
});
afterEach(() => db.close());

const clock = clockAt(DateTime.makeUnsafe("2026-10-10T19:00:00Z"));

/** The planning, collab and drafts services over `db`, as the owner or the studio. */
const layer = (as: "owner" | "studio" = "owner") =>
  Layer.mergeAll(Drafts.layer, Collab.layer).pipe(
    Layer.provideMerge(Readiness.layer),
    Layer.provideMerge(Planning.layer),
    Layer.provideMerge(as === "owner" ? sqlLayer(db) : studioLayer(db)),
    Layer.provideMerge(clock),
  );

type Services = Planning | Collab | Drafts | Readiness | SqlClient;

const exit = <A, E>(
  effect: Effect.Effect<A, E, Services>,
  options: { as?: "owner" | "studio"; env?: Record<string, string> } = {},
) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(layer(options.as)),
      // A config without ALLTHINGS_ACTOR, when a test asks for one.
      options.env === undefined
        ? (self) => self
        : Effect.provide(configFrom(options.env)),
    ),
  );

const value = async <A, E>(
  effect: Effect.Effect<A, E, Services>,
  options?: { as?: "owner" | "studio"; env?: Record<string, string> },
): Promise<A> => {
  const result = await exit(effect, options);
  if (Exit.isFailure(result)) throw Cause.squash(result.cause);
  return result.value;
};

const refusal = async <A, E>(
  effect: Effect.Effect<A, E, Services>,
  options?: { as?: "owner" | "studio"; env?: Record<string, string> },
): Promise<string> => {
  const result = await exit(effect, options);
  if (Exit.isSuccess(result)) throw new Error("expected a refusal");
  const error = Cause.squash(result.cause);
  return error instanceof Error ? error.message : String(error);
};

const logOf = async () =>
  (
    await db.query<{
      actor: string;
      command: string;
      summary: string;
      payload: unknown;
    }>(
      `SELECT actor, command, summary, payload FROM planning.draft_log
       WHERE event_id = '${draftId}' ORDER BY at, command`,
    )
  ).rows;

const lineup = (planning: Planning["Service"]) =>
  planning.setDraftLineup(draft, [
    { role: "mc", profile: "Ada Lovelace" },
    { role: "organizer", profile: "Grace Hopper" },
  ]);

describe("a write and its line", () => {
  test("are kept together, as ALLTHINGS_ACTOR", async () => {
    await value(Planning.use(lineup));
    expect(await logOf()).toEqual([
      {
        actor: "test/core",
        command: "plan lineup set",
        summary: "Its lineup is now 1 organizer, 1 mc.",
        payload: {
          lineup: [
            { role: "mc", profileId: "b0000000-0000-4000-8000-000000000001" },
            {
              role: "organizer",
              profileId: "b0000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
    ]);
  });

  test("roll back together: a dry run, or a failure later in the transaction", async () => {
    await value(rolledBack(Planning.use(lineup)));
    await exit(
      Effect.gen(function* () {
        const sql = yield* SqlClient;
        yield* sql.withTransaction(
          Effect.andThen(Planning.use(lineup), Effect.fail("later")),
        );
      }),
    );
    expect(await logOf()).toEqual([]);
    const { rows } = await db.query(
      `SELECT 1 FROM planning.draft_people WHERE event_id = '${draftId}'`,
    );
    expect(rows).toEqual([]);
  });

  test("a line that can't be written takes its write back", async () => {
    // A log that refuses this one line, as a full disk or a broken grant
    // would: the lineup goes back with it.
    await db.exec(
      `ALTER TABLE planning.draft_log ADD CONSTRAINT made_up_refusal CHECK (command <> 'plan lineup set')`,
    );
    const refused = await exit(Planning.use(lineup));
    expect(Exit.isFailure(refused)).toBe(true);
    expect(await logOf()).toEqual([]);
    const { rows } = await db.query(
      `SELECT 1 FROM planning.draft_people WHERE event_id = '${draftId}'`,
    );
    expect(rows).toEqual([]);
  });

  test("collab's writes add theirs, never an email", async () => {
    const round = await value(
      Collab.use((collab) =>
        collab.addRound(draft, { position: 1, title: "Made-up round" }),
      ),
    );
    const plan = await value(
      Collab.use((collab) =>
        collab.invite({
          event: draft,
          email: "host@example.com",
          name: "Made-up Host",
          role: "round_host",
          round: round.position,
        }),
      ),
    );
    await value(
      Collab.use((collab) =>
        collab.invite(
          {
            event: draft,
            email: "host@example.com",
            name: "Made-up Host",
            role: "round_host",
            round: round.position,
          },
          plan.token,
        ),
      ),
    );
    const lines = await logOf();
    expect(lines.map((line) => line.command).toSorted()).toEqual([
      "collab invite",
      "collab round add",
    ]);
    expect(JSON.stringify(lines)).not.toContain("@");
  });
});

describe("ALLTHINGS_ACTOR", () => {
  test("a write refuses without it, and writes nothing", async () => {
    expect(await refusal(Planning.use(lineup), { env: {} })).toContain(
      "set ALLTHINGS_ACTOR",
    );
    expect(
      await refusal(
        Drafts.use((drafts) => drafts.addNote(draft, "note", "Made up.")),
        { env: {} },
      ),
    ).toContain("set ALLTHINGS_ACTOR");
    expect(
      await refusal(
        Collab.use((collab) =>
          collab.addRound(draft, { position: 1, title: "Made-up round" }),
        ),
        { env: {} },
      ),
    ).toContain("set ALLTHINGS_ACTOR");
    const { rows } = await db.query(
      `SELECT (SELECT count(*) FROM planning.draft_people)::int AS people,
         (SELECT count(*) FROM planning.draft_notes)::int AS notes,
         (SELECT count(*) FROM planning.rounds)::int AS rounds,
         (SELECT count(*) FROM planning.draft_log)::int AS lines`,
    );
    expect(rows).toEqual([{ people: 0, notes: 0, rounds: 0, lines: 0 }]);
  });

  test("a label it isn't is refused too", async () => {
    expect(
      await refusal(Planning.use(lineup), {
        env: { ALLTHINGS_ACTOR: "Erik Thorelli" },
      }),
    ).toContain("isn't a label");
  });

  test("reads never ask", async () => {
    await value(
      Effect.all([
        Planning.use((planning) => planning.listIdeas()),
        Drafts.use((drafts) => drafts.status(draft)),
      ]),
      { env: {} },
    );
  });

  test("a write that goes to Luma asks before it sends anything", async () => {
    const luma = fakeLumaBy((url) => url.pathname, {});
    const result = await Effect.runPromiseExit(
      Studio.use((studio) =>
        studio.update(
          { _tag: "Luma", lumaEventId: "evt-draft" },
          { name: "Renamed" },
          false,
        ),
      ).pipe(
        Effect.provide(
          Studio.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                LumaWrite.layer.pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      luma.layer,
                      configFrom({ LUMA_API_KEY: "test" }),
                    ),
                  ),
                ),
                Planning.layer,
                Promo.layer,
                Readiness.layer,
              ),
            ),
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clock),
          ),
        ),
        Effect.provide(configFrom({})),
      ),
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(
      String(Cause.squash(Exit.isFailure(result) ? result.cause : Cause.empty)),
    ).toContain("set ALLTHINGS_ACTOR");
    expect(luma.requests).toEqual([]);
  });
});

describe("the log and the notes", () => {
  test("the log is append-only, for the owner too", async () => {
    await value(Planning.use(lineup));
    for (const statement of [
      `UPDATE planning.draft_log SET summary = 'Changed.'`,
      `DELETE FROM planning.draft_log`,
      `TRUNCATE planning.draft_log`,
    ]) {
      await expect(db.exec(statement)).rejects.toThrow("append-only");
    }
  });

  test("a note is written once; only an open question is resolved, once", async () => {
    const decision = await value(
      Drafts.use((drafts) => drafts.addNote(draft, "decision", "Five rounds.")),
    );
    const question = await value(
      Drafts.use((drafts) =>
        drafts.addNote(draft, "question", "CodeRabbit or Vercel?"),
      ),
    );
    expect(question).toMatchObject({
      kind: "question",
      actor: "test/core",
      text: "CodeRabbit or Vercel?",
      resolvedAt: null,
    });
    expect(
      await refusal(Drafts.use((drafts) => drafts.resolveNote(decision.id))),
    ).toContain("only a question is resolved");
    const resolved = await value(
      Drafts.use((drafts) => drafts.resolveNote(question.id)),
    );
    expect(resolved.resolvedAt).not.toBeNull();
    expect(
      await refusal(Drafts.use((drafts) => drafts.resolveNote(question.id))),
    ).toContain("already resolved");
    for (const statement of [
      `UPDATE planning.draft_notes SET text = 'Changed.' WHERE id = '${decision.id}'`,
      `UPDATE planning.draft_notes SET resolved_at = NULL WHERE id = '${question.id}'`,
      `DELETE FROM planning.draft_notes`,
    ]) {
      await expect(db.exec(statement)).rejects.toThrow("written once");
    }
    expect((await logOf()).map((line) => line.command).toSorted()).toEqual([
      "plan note",
      "plan note",
      "plan note resolve",
    ]);
    // The log says what kind was added, never the text.
    expect(JSON.stringify(await logOf())).not.toContain("CodeRabbit");
  });
});

describe("plan status", () => {
  test("shows all of a draft, in one read", async () => {
    await value(Planning.use(lineup));
    await value(
      Planning.use((planning) =>
        Effect.gen(function* () {
          const speaker = yield* planning.addWantedSpeaker(
            { _tag: "Profile", ref: "Linus" },
            { topics: ["git"], status: "asked" },
          );
          yield* planning.addDraftTalk(draft, {
            kind: "talk",
            title: "Made-up talk",
            people: [{ role: "speaker", wantedSpeaker: speaker.id }],
          });
          yield* planning.addHostProspect(
            { _tag: "NewCompany", name: "Made-up Co" },
            undefined,
            { status: "asked" },
          );
        }),
      ),
    );
    await value(
      Collab.use((collab) =>
        collab.addRound(draft, { position: 1, title: "Made-up round" }),
      ),
    );
    await value(
      Drafts.use((drafts) =>
        Effect.all([
          drafts.addNote(draft, "question", "Which venue?"),
          drafts.addNote(draft, "decision", "Five rounds."),
          drafts.addNote(draft, "note", "Ada is in."),
        ]),
      ),
    );
    const status = await value(Drafts.use((drafts) => drafts.status(draft)));
    expect(status.event).toMatchObject({
      slug: draft,
      luma: { eventId: "evt-draft", visibility: "private", publish: null },
      startDate: "2026-11-18T02:00:00Z",
      venue: { name: "Secret" },
      program: "talks",
    });
    expect(["current", "stale", "not ours", "none"]).toContain(
      status.event.cover,
    );
    expect(status.readiness.ready).toBe(false);
    expect(status.readiness.blockers.length).toBeGreaterThan(0);
    expect(status.readiness.collaboration).toBe("read");
    expect(status.lineup).toEqual([
      { role: "organizer", position: 0, name: "Grace Hopper" },
      { role: "mc", position: 0, name: "Ada Lovelace" },
    ]);
    expect(status.talks).toEqual([
      {
        position: 1,
        kind: "talk",
        title: "Made-up talk",
        people: [
          { role: "speaker", name: "Linus", status: "asked", hasProfile: true },
        ],
      },
    ]);
    expect(status.wantedHosts).toContainEqual({
      name: "Made-up Co",
      status: "asked",
    });
    expect(status.collab).toEqual({
      readable: true,
      rounds: [
        { position: 1, title: "Made-up round", hosts: 0, handedIn: false },
      ],
      invites: {},
      submissions: 0,
    });
    expect(status.notes.openQuestions.map((note) => note.text)).toEqual([
      "Which venue?",
    ]);
    expect(status.notes.decisions.map((note) => note.text)).toEqual([
      "Five rounds.",
    ]);
    expect(status.notes.notes.map((note) => note.text)).toEqual(["Ada is in."]);
    // Newest first; lines made in the same instant may come in either order.
    expect(status.log.map((line) => line.command).toSorted()).toEqual([
      "collab round add",
      "plan lineup set",
      "plan lineup talk add",
      "plan note",
      "plan note",
      "plan note",
    ]);
    expect(
      status.log
        .map((line) => line.at)
        .toSorted()
        .toReversed(),
    ).toEqual(status.log.map((line) => line.at));
  });

  test("as the studio, notes are written and resolved, with their lines", async () => {
    const question = await value(
      Drafts.use((drafts) => drafts.addNote(draft, "question", "Which venue?")),
      { as: "studio" },
    );
    await value(
      Drafts.use((drafts) => drafts.resolveNote(question.id)),
      { as: "studio" },
    );
    expect((await logOf()).map((line) => line.command).toSorted()).toEqual([
      "plan note",
      "plan note resolve",
    ]);
  });

  test("as the studio, reads the collaboration, through its own policies", async () => {
    await value(
      Collab.use((collab) =>
        collab.addRound(draft, { position: 1, title: "Made-up round" }),
      ),
      { as: "studio" },
    );
    const status = await value(
      Drafts.use((drafts) => drafts.status(draft)),
      {
        as: "studio",
      },
    );
    expect(status.collab).toEqual({
      readable: true,
      rounds: [
        { position: 1, title: "Made-up round", hosts: 0, handedIn: false },
      ],
      invites: {},
      submissions: 0,
    });
    expect(status.readiness.collaboration).toBe("read");
  });

  test("keeps only the last 20 lines, newest first", async () => {
    for (let i = 0; i < 22; i++) {
      await value(
        Drafts.use((drafts) => drafts.addNote(draft, "note", `${i}`)),
      );
    }
    const status = await value(Drafts.use((drafts) => drafts.status(draft)));
    expect(status.log).toHaveLength(20);
    expect(status.notes.notes).toHaveLength(22);
  });
});
