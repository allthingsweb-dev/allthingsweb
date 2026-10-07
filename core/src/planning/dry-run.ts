import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/**
 * A planning write's dry run (`bun run plan … --dry-run`): the write runs
 * for real, inside a transaction that is always rolled back. Every check the
 * write makes, every name it resolves and every row it would return are
 * the real ones, and nothing is kept.
 */

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {}) {}

/** Runs `effect` in a transaction that is rolled back: its result, nothing kept. */
export const rolledBack = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    let result: A | undefined;
    yield* sql
      .withTransaction(
        effect.pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              result = value;
            }),
          ),
          Effect.andThen(Effect.fail(new RolledBack())),
        ),
      )
      .pipe(Effect.catchTag("RolledBack", () => Effect.void));
    return result as A;
  });

/** `effect` as it is, or rolled back when `dryRun`. */
export const rollingBackIf =
  (dryRun: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    dryRun ? rolledBack(effect) : effect;
