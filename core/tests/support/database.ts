import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Layer } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { migratedDatabase } from "../../scripts/pglite.ts";

/**
 * An in-process Postgres with the production schema: core's migrations,
 * applied by the migrator production will use, then tests/seed.sql. Tests run
 * without a server or a network. tests/migrations.test.ts holds those
 * migrations to production's catalog and to the app's drizzle history.
 */

export {
  expectedSchema,
  migratedDatabase,
  migratedTemplate,
  sqlLayer,
} from "../../scripts/pglite.ts";

/** The instant every test reads the catalog at. */
export const now = DateTime.makeUnsafe("2026-10-03T19:00:00Z");

/** The SQL of tests/seed.sql. */
export const readSeed = (): Promise<string> =>
  Bun.file(new URL("../seed.sql", import.meta.url)).text();

/** A migrated database holding tests/seed.sql. */
export async function seededDatabase(): Promise<PGlite> {
  const db = await migratedDatabase();
  try {
    await db.exec(await readSeed());
  } catch (cause) {
    await db.close();
    throw cause;
  }
  return db;
}

/** A clock stopped at `instant`. */
export const clockAt = (instant: DateTime.Utc) =>
  Layer.effectDiscard(TestClock.setTime(DateTime.toEpochMillis(instant))).pipe(
    Layer.provideMerge(TestClock.layer()),
  );

/** A clock stopped at {@link now}. */
export const clockLayer = clockAt(now);
