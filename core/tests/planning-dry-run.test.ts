import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Layer } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { rolledBack, rollingBackIf } from "../src/planning/dry-run.ts";
import { Planning } from "../src/planning/planning.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * `bun run plan … --dry-run` (src/planning/dry-run.ts): the write runs for
 * real in a transaction that is rolled back, so its result and its refusals
 * are the real ones and nothing is kept.
 */

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

const run = <A, E>(effect: Effect.Effect<A, E, Planning | SqlClient>) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(
        Planning.layer.pipe(
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  );

const ideas = async () =>
  (
    await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM planning.ideas",
    )
  ).rows[0]?.count;

const addIdea = Planning.use((planning) =>
  planning.addIdea({
    title: "Made-up quiz night",
    pitch: "Rounds on everything.",
    program: "social",
    topic: "trivia",
    inspiredBySlug: "2026-08-12-react-at-acme",
  }),
);

describe("a dry run", () => {
  test("gives the write's real result and keeps nothing", async () => {
    const exit = await run(rolledBack(addIdea));
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value).toMatchObject({
      title: "Made-up quiz night",
      topic: "trivia",
      inspiredBy: { slug: "2026-08-12-react-at-acme" },
    });
    expect(await ideas()).toBe(0);
  });

  test("refuses what the write refuses", async () => {
    const exit = await run(
      rolledBack(
        Planning.use((planning) =>
          planning.addIdea({
            title: "Made-up",
            pitch: "Made up.",
            program: "social",
            inspiredBySlug: "no-such-evening",
          }),
        ),
      ),
    );
    if (Exit.isSuccess(exit)) throw new Error("expected a refusal");
    expect(String(Cause.squash(exit.cause))).toContain("no-such-evening");
    expect(await ideas()).toBe(0);
  });

  test("a failure that shares the rollback's tag still fails", async () => {
    const lookalike = { _tag: "RolledBack" as const };
    const exit = await run(rolledBack(Effect.fail(lookalike)));
    if (Exit.isSuccess(exit)) throw new Error("expected the failure");
    expect(Cause.squash(exit.cause)).toBe(lookalike);
  });

  test("without --dry-run the write is kept", async () => {
    const exit = await run(rollingBackIf(false)(addIdea));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await ideas()).toBe(1);
  });
});
