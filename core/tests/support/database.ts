import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import * as TestClock from "effect/testing/TestClock";
import {
  migratedDatabase,
  sqlLayer as pgliteLayer,
} from "../../scripts/pglite.ts";
import {
  provisionLoginRole,
  type Statements,
} from "../../../infra/scripts/login-role.ts";
import {
  grantStatements as studioGrants,
  STUDIO,
} from "../../../infra/scripts/studio.ts";

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
} from "../../scripts/pglite.ts";

/**
 * Which role a suite's statements run as: the owner, as PGlite's user is,
 * or, with CORE_TEST_AS=studio (`bun run test:studio`), the studio role,
 * made with infra/scripts/studio.ts's own statements. Then every
 * {@link sqlLayer} switches to it while its scope is open and back after,
 * so a test's own setup and checks (`db.exec`, `db.query`) stay the
 * owner's and only what the code under test runs is the studio's.
 */
export const testRole: "owner" | "studio" =
  process.env["CORE_TEST_AS"] === "studio" ? "studio" : "owner";

/**
 * Whether this run is the studio's (`bun run test:studio`): a test of what
 * no studio command does (the sync's refresh, another role's view, a
 * closed database) is skipped in it, with `test.skipIf(studioRun)`.
 */
export const studioRun = testRole === "studio";

/** Makes the studio role on `db`, once, as the script makes it. */
export async function provisionStudio(db: PGlite): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1`,
    [STUDIO],
  );
  const owner: Statements = {
    unsafe: async (query, values) =>
      (await db.query(query, values === undefined ? [] : [...values])).rows,
  };
  if (rows.length === 0) await provisionLoginRole(owner, STUDIO, "test-only");
  for (const statement of studioGrants()) await db.exec(statement);
}

/** `SqlClient` over `db` as the studio role, made first if need be; the owner again once its scope closes. */
export const studioLayer = (db: PGlite) =>
  pgliteLayer(db).pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.acquireRelease(
          Effect.promise(async () => {
            await provisionStudio(db);
            await db.exec(`SET ROLE ${STUDIO}`);
          }),
          () => Effect.promise(() => db.exec("RESET ROLE")),
        ),
      ),
    ),
  );

/** `SqlClient` over `db`, as {@link testRole}. The caller keeps ownership of `db` and closes it. */
export const sqlLayer = (db: PGlite) =>
  testRole === "owner" ? pgliteLayer(db) : studioLayer(db);

/**
 * The connection string a CLI test hands the command it starts, for the
 * database at `databaseUrl` on a real Postgres: the owner's, or, in the
 * studio's run, the studio role's, made there with its script's statements
 * and a password of this run's (roles belong to the server, so each run
 * sets its own). `owner` is a client of that database as its owner.
 */
export async function cliUrlFor(
  owner: Statements,
  databaseUrl: string,
): Promise<string> {
  if (testRole !== "studio") return databaseUrl;
  const password = crypto.randomUUID();
  await provisionLoginRole(owner, STUDIO, password);
  for (const statement of studioGrants()) await owner.unsafe(statement);
  const studio = new URL(databaseUrl);
  studio.username = STUDIO;
  studio.password = password;
  return studio.href;
}

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
