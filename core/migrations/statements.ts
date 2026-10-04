import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

/** A migration: what the migrator runs, inside its transaction. */
export type Migration = Effect.Effect<void, SqlError, SqlClient>;

/**
 * A migration that runs `queries` in order, one query each. Statements are
 * listed rather than split from one script, so nothing has to parse SQL, and
 * a failure logs the statement that failed.
 */
export const statements = (queries: ReadonlyArray<string>): Migration =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    for (const statement of queries) {
      yield* sql
        .unsafe(statement)
        .pipe(
          Effect.tapError(() =>
            Effect.logError(`Migration statement failed: ${statement}`),
          ),
        );
    }
  });
