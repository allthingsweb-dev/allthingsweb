import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { PGlite } from "@electric-sql/pglite";
import * as Migrator from "effect/sql/Migrator";
import migration from "../migrations/0035_hack_evening_time.ts";
import { migrations } from "../migrations/index.ts";
import * as Migrations from "../src/migrator.ts";
import {
  migratedDatabase,
  seededDatabase,
  sqlLayer,
} from "./support/database.ts";

/**
 * migrations/0035_hack_evening_time.ts on a database holding the evening as
 * production did: seven hours early, the local time stored as UTC. The
 * times are written out here, not read from the migration, so a wrong
 * correction there can't pass.
 */

const id = "e0000000-0000-4000-8000-000000000703";
/** Another evening with the same wrong times but another Luma event. */
const decoy = "e0000000-0000-4000-8000-000000000704";

/** The evening as production holds it. */
const seedEvening = `
  DELETE FROM events WHERE id IN ('${id}', '${decoy}');
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_hackathon, is_draft, luma_event_id, updated_at) VALUES
    ('${id}', '2025-03-12-all-things-web-hack-evening', 'All Things Web Hack Evening', '', '2025-03-12T17:30:00Z', '2025-03-12T20:30:00Z', 100, false, false, 'evt-4tdtev7Ap2qLcPW', '2025-03-01T00:00:00Z'),
    ('${decoy}', '2025-03-12-decoy', 'Decoy', '', '2025-03-12T17:30:00Z', '2025-03-12T20:30:00Z', 100, false, false, 'evt-decoy', '2025-03-01T00:00:00Z');
`;

/** Luma's times: 5:30 to 8:30 PM in San Francisco on 2025-03-12. */
const lumaTimes = {
  start: "2025-03-13T00:30:00Z",
  end: "2025-03-13T03:30:00Z",
};

const stored = async (db: PGlite) =>
  (
    await db.query<{ start: string; end: string; changed: boolean }>(
      `SELECT to_char(start_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start,
              to_char(end_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end,
              updated_at > '2025-03-01T00:00:00Z' AS changed
       FROM events WHERE id = $1`,
      [id],
    )
  ).rows[0];

const db = await seededDatabase();
afterAll(() => db.close());

describe("the migration", () => {
  // Each test starts from the evening as production holds it, so either runs alone.
  beforeEach(() => db.exec(seedEvening));

  const migrate = () =>
    Effect.runPromise(migration.pipe(Effect.provide(sqlLayer(db))));

  /** Every other evening's times, which the migration must not touch. */
  const others = async () =>
    (
      await db.query(
        `SELECT id, start_date, end_date, updated_at FROM events WHERE id <> $1 ORDER BY id`,
        [id],
      )
    ).rows;

  test("sets the evening to Luma's times, 5:30 to 8:30 PM in San Francisco, and touches nothing else", async () => {
    const before = await others();
    await migrate();
    expect(await stored(db)).toEqual({ ...lumaTimes, changed: true });
    expect(await others()).toEqual(before);
  });

  test.each([
    ["only its start", "start_date = '2025-03-13T00:30:00Z'"],
    ["only its end", "end_date = '2025-03-13T03:30:00Z'"],
  ])(
    "leaves the evening alone when %s is already corrected",
    async (_which, set) => {
      await db.exec(`UPDATE events SET ${set} WHERE id = '${id}'`);
      const row = () =>
        db.query(
          `SELECT start_date, end_date, updated_at FROM events WHERE id = $1`,
          [id],
        );
      const before = (await row()).rows;
      await migrate();
      expect((await row()).rows).toEqual(before);
    },
  );

  test("a second run changes nothing", async () => {
    await migrate();
    const { rows: before } = await db.query(
      `SELECT updated_at FROM events WHERE id = $1`,
      [id],
    );
    await migrate();
    const { rows: after } = await db.query(
      `SELECT updated_at FROM events WHERE id = $1`,
      [id],
    );
    expect(after).toEqual(before);
    expect(await stored(db)).toMatchObject(lumaTimes);
  });
});

describe("through the migrator", () => {
  test("bun run migrate, on a database migrated through 0034, applies 0035 and corrects the evening", async () => {
    // Every migration before this one, whatever comes after it.
    const before = Migrator.fromRecord(
      Object.fromEntries(
        Object.entries(migrations).filter(
          ([name]) => Number(name.split("_")[0]) < 35,
        ),
      ),
    );
    const old = await migratedDatabase(before);
    try {
      await old.exec(seedEvening);
      const applied = await Effect.runPromise(
        Migrations.run().pipe(Effect.provide(sqlLayer(old))),
      );
      // Later migrations may run too; this one must be among them.
      expect(applied.map((done) => `${done.id}_${done.name}`)).toContain(
        "35_hack_evening_time",
      );
      const { rows } = await old.query<{ name: string }>(
        `SELECT name FROM effect_sql.migrations WHERE name = 'hack_evening_time'`,
      );
      expect(rows).toHaveLength(1);
      expect(await stored(old)).toEqual({ ...lumaTimes, changed: true });
    } finally {
      await old.close();
    }
  });
});
