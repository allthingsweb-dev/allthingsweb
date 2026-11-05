import { afterAll, beforeEach, expect, test } from "bun:test";
import { Effect } from "effect";
import migration, {
  lumaEventId,
  right,
  wrong,
} from "../migrations/0035_hack_evening_time.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * migrations/0035_hack_evening_time.ts on a database holding the evening as
 * production did: seven hours early, the local time stored as UTC.
 */

const id = "e0000000-0000-4000-8000-000000000703";

const db = await seededDatabase();
afterAll(() => db.close());

// Each test starts from the evening as production holds it, so either runs alone.
beforeEach(() =>
  db.exec(`
    DELETE FROM events WHERE id = '${id}';
    INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_hackathon, is_draft, luma_event_id, updated_at) VALUES
      ('${id}', '2025-03-12-all-things-web-hack-evening', 'All Things Web Hack Evening', '', '${wrong.start}', '${wrong.end}', 100, false, false, '${lumaEventId}', '2025-03-01T00:00:00Z');
  `),
);

const migrate = () =>
  Effect.runPromise(migration.pipe(Effect.provide(sqlLayer(db))));

const stored = async () =>
  (
    await db.query<{ start: string; end: string; changed: boolean }>(
      `SELECT to_char(start_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start,
              to_char(end_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end,
              updated_at > '2025-03-01T00:00:00Z' AS changed
       FROM events WHERE id = $1`,
      [id],
    )
  ).rows[0];

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
  expect(await stored()).toEqual({
    start: right.start,
    end: right.end,
    changed: true,
  });
  expect(await others()).toEqual(before);
});

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
  expect(await stored()).toMatchObject({ start: right.start, end: right.end });
});
