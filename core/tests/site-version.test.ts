import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Layer } from "effect";
import { SiteVersion, siteTables } from "../src/site-version.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The public data's version against the migrated production schema with
 * tests/seed.sql: what changes it, what doesn't, and the instants pages may
 * change at without a write.
 */

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

const database = async () => {
  const db = await seededDatabase();
  opened.push(db);
  return db;
};

const read = (db: PGlite) =>
  Effect.runPromise(
    SiteVersion.use((site) => site.read).pipe(
      Effect.provide(SiteVersion.layer.pipe(Layer.provide(sqlLayer(db)))),
    ),
  );

describe("the site's version", () => {
  test("is the same for the same data, read twice", async () => {
    const db = await database();
    const first = await read(db);
    expect(first.version).toMatch(/^[0-9a-f]{32}$/);
    expect(await read(db)).toEqual(first);
  });

  /** A row for each table the seed leaves empty. */
  const rowFor: Readonly<Record<string, string>> = {
    event_people: `INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'mc', 0, 'site', now())`,
    external_talks: `INSERT INTO external_talks (profile_id, title, event_name, kind, given_on, source_url, read_on, updated_at) VALUES ('b0000000-0000-4000-8000-000000000001', 'A talk', 'A conference', 'conference', '2026-01-01', 'https://example.com', '2026-01-02', now())`,
    event_schedule_items: `INSERT INTO event_schedule_items (event_id, position, time, title, updated_at) VALUES ('e0000000-0000-4000-8000-000000000001', 0, '6:00', 'Doors', now())`,
    event_notes: `INSERT INTO event_notes (event_id, position, label, body, updated_at) VALUES ('e0000000-0000-4000-8000-000000000001', 0, 'Parking', 'Around the corner', now())`,
    profile_slugs: `INSERT INTO profile_slugs (slug, profile_id) VALUES ('ada-before', 'b0000000-0000-4000-8000-000000000001')`,
    event_slugs: `INSERT INTO event_slugs (slug, event_id) VALUES ('react-before', 'e0000000-0000-4000-8000-000000000001')`,
  };

  test.each([...siteTables])(
    "changes with any write to %s",
    async (table: string) => {
      const db = await database();
      const before = (await read(db)).version;
      // Any edit changes a row's text: here, when it was last updated, or
      // the row itself where the table keeps no such time.
      const { rows } = await db.query(
        `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'updated_at'`,
        [table],
      );
      await db.exec(
        rowFor[table] ??
          (rows.length > 0
            ? `UPDATE public.${table} SET updated_at = updated_at + interval '1 second' WHERE ctid = (SELECT ctid FROM public.${table} LIMIT 1)`
            : `DELETE FROM public.${table} WHERE ctid = (SELECT ctid FROM public.${table} LIMIT 1)`),
      );
      expect((await read(db)).version).not.toBe(before);
    },
  );

  test("keeps its version through writes the site doesn't read", async () => {
    const db = await database();
    const before = await read(db);
    await db.exec(
      `INSERT INTO planning.ideas (title, pitch, program) VALUES ('An idea', 'Why', 'talks')`,
    );
    expect(await read(db)).toEqual(before);
  });

  test("names the minute each published evening goes live and the minute it is over, and no draft's", async () => {
    const db = await database();
    const { boundaries } = await read(db);
    const { rows } = await db.query<{ starts: number; ends: number }>(
      `SELECT floor(extract(epoch FROM start_date) * 1000)::float8 AS starts,
         floor(extract(epoch FROM end_date) * 1000)::float8 AS ends
       FROM events WHERE is_draft = false`,
    );
    const minute = 60_000;
    const expected = [
      ...new Set(
        rows.flatMap(({ starts, ends }) => [
          starts,
          Math.floor(ends / minute) * minute + minute,
        ]),
      ),
    ].toSorted((a, b) => a - b);
    expect(boundaries).toEqual(expected);
    // React at Acme ends at 04:00 sharp: live through 04:00, over from 04:01.
    expect(boundaries).toContain(Date.UTC(2026, 7, 13, 4, 1));
    expect(boundaries).not.toContain(Date.UTC(2026, 7, 13, 4, 0));
    const draft = await db.query<{ start: number }>(
      `SELECT floor(extract(epoch FROM start_date) * 1000)::float8 AS start FROM events WHERE is_draft = true`,
    );
    for (const { start } of draft.rows) expect(boundaries).not.toContain(start);
  });
});
