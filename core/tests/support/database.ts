import { PGlite } from "@electric-sql/pglite";
import { PgliteClient } from "@effect/sql-pglite";
import { DateTime, Layer, Schema } from "effect";
import * as TestClock from "effect/testing/TestClock";

/**
 * An in-process Postgres with the production schema: the app's drizzle
 * migrations, replayed in journal order, then tests/seed.sql. Tests therefore
 * follow every schema change the app ships, without a server or a network.
 */

const migrations = new URL("../../../app/migrations/", import.meta.url);

/** The instant every test reads the catalog at. */
export const now = DateTime.makeUnsafe("2026-10-03T19:00:00Z");

const Journal = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ idx: Schema.Int, tag: Schema.String })),
});

/**
 * Statements that cannot replay on an empty database, each with the reason
 * its omission leaves the schema unchanged. Every entry must still match a
 * statement, so the list cannot go stale silently.
 */
const unreplayable: ReadonlyArray<{
  readonly tag: string;
  readonly statement: string;
  readonly reason: string;
}> = [
  {
    tag: "0005_skinny_madelyne_pryor",
    statement: `ALTER TABLE "hack_users" ADD CONSTRAINT "hack_users_hack_id_user_id_pk" PRIMARY KEY("hack_id","user_id");`,
    reason:
      "It adds the key before its column exists; 0009 adds the same key, and 0014 drops the table.",
  },
];

/** drizzle-kit's migrator runs each file as statements split at this marker. */
const breakpoint = "--> statement-breakpoint";

const readMigration = (tag: string): Promise<string> =>
  Bun.file(new URL(`${tag}.sql`, migrations)).text();

/** Applies the app's migrations to an empty database. */
export async function migrate(db: PGlite): Promise<void> {
  const journal = Schema.decodeUnknownSync(Journal)(
    await Bun.file(new URL("meta/_journal.json", migrations)).json(),
  );
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  // Neon Auth creates neon_auth.users_sync before any migration ran, and 0001
  // already references it. 0010 records that table's definition (IF NOT
  // EXISTS), so running it first stands in for Neon.
  await db.exec(`CREATE SCHEMA neon_auth;`);
  await db.exec(await readMigration("0010_wakeful_reptil"));

  const skipped = new Set<string>();
  for (const { tag } of entries) {
    for (const part of (await readMigration(tag)).split(breakpoint)) {
      const statement = part.trim();
      if (statement === "") continue;
      const known = unreplayable.find(
        (entry) => entry.tag === tag && entry.statement === statement,
      );
      if (known !== undefined) {
        skipped.add(`${known.tag}: ${known.statement}`);
        continue;
      }
      try {
        await db.exec(statement);
      } catch (cause) {
        throw new Error(`Migration ${tag} failed at: ${statement}`, { cause });
      }
    }
  }
  for (const entry of unreplayable) {
    if (!skipped.has(`${entry.tag}: ${entry.statement}`)) {
      throw new Error(
        `Migration ${entry.tag} no longer contains the skipped statement; update tests/support/database.ts.`,
      );
    }
  }
}

/** A migrated database holding tests/seed.sql. */
export async function seededDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  await migrate(db);
  await db.exec(await Bun.file(new URL("../seed.sql", import.meta.url)).text());
  return db;
}

/** `SqlClient` over `db`. The caller keeps ownership of `db` and closes it. */
export const sqlLayer = (db: PGlite) => PgliteClient.layer({ liveClient: db });

/** A clock stopped at `instant`. */
export const clockAt = (instant: DateTime.Utc) =>
  Layer.effectDiscard(TestClock.setTime(DateTime.toEpochMillis(instant))).pipe(
    Layer.provideMerge(TestClock.layer()),
  );

/** A clock stopped at {@link now}. */
export const clockLayer = clockAt(now);
