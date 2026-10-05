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

/**
 * The data directory of a database with every migration applied, made once
 * per process. Starting a PGlite means running initdb in WebAssembly, and the
 * migrations then run on top: about half a second locally and well over a
 * second on a CI runner, for every test that wants a database. A database
 * restored from this directory starts in about a tenth of that, so tests no
 * longer spend most of their time limit (5 s) before they begin.
 *
 * It is kept on `globalThis`, so every test file in a `bun test` run shares
 * one, and tests/preload.ts makes it before the first test starts, so no
 * test's time pays for it.
 */
const templateKey = Symbol.for("allthings/core/migrated-template");
const templates = globalThis as { [templateKey]?: Promise<Blob> };

export const migratedTemplate = (): Promise<Blob> => {
  const made = (templates[templateKey] ??= freshlyMigrated(allMigrations).then(
    async (db) => {
      try {
        return await db.dumpDataDir("none");
      } finally {
        await db.close();
      }
    },
  ));
  // A failure isn't kept: the next caller tries again.
  made.catch(() => {
    delete templates[templateKey];
  });
  return made;
};

/**
 * An empty in-process database with `loader`'s migrations applied: every
 * migration (the default) restores a copy of {@link migratedTemplate}, any
 * other list of them is applied to a new database.
 */
export async function migratedDatabase(
  loader: Migrator.Loader = allMigrations,
): Promise<PGlite> {
  return loader === allMigrations
    ? PGlite.create({ loadDataDir: await migratedTemplate() })
    : freshlyMigrated(loader);
}

/** A new database, initdb and then `loader`'s migrations. */
async function freshlyMigrated(loader: Migrator.Loader): Promise<PGlite> {
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
