import { PGlite } from "@electric-sql/pglite";
import { PgliteClient } from "@effect/sql-pglite";
import { Effect, type Schema } from "effect";
import type * as Migrator from "effect/sql/Migrator";
import type { SqlError } from "effect/sql/SqlError";
import { loader as allMigrations } from "../migrations/index.ts";
import * as Migrations from "../src/migrator.ts";
import * as SchemaSnapshot from "../src/schema-snapshot.ts";

/**
 * Databases the migrations build in process, with PGlite (Postgres 18;
 * production runs 17, which reads the same, see src/schema-snapshot.ts): for
 * the tests, and for `migrate stamp` to learn the schema the migrations create
 * without a server.
 */

/** `SqlClient` over `db`. The caller keeps ownership of `db` and closes it. */
export const sqlLayer = (db: PGlite) => PgliteClient.layer({ liveClient: db });

/** An empty in-process database with `loader`'s migrations applied. */
export async function migratedDatabase(
  loader: Migrator.Loader = allMigrations,
): Promise<PGlite> {
  const db = await PGlite.create();
  try {
    await Effect.runPromise(
      Migrations.run(loader).pipe(Effect.provide(sqlLayer(db))),
    );
  } catch (cause) {
    await db.close();
    throw cause;
  }
  return db;
}

/** The schema `loader`'s migrations create, as {@link SchemaSnapshot.snapshot} reads it. */
export const expectedSchema = (
  loader: Migrator.Loader = allMigrations,
): Effect.Effect<
  ReadonlyArray<string>,
  Migrator.MigrationError | SqlError | Schema.SchemaError
> =>
  Effect.acquireUseRelease(
    Effect.promise(() => PGlite.create()),
    (db) =>
      Migrations.run(loader).pipe(
        Effect.andThen(SchemaSnapshot.snapshot),
        Effect.provide(sqlLayer(db)),
      ),
    (db) => Effect.promise(() => db.close()),
  );
