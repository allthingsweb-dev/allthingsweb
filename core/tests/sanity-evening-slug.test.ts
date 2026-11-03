import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import migration, {
  rightSlug,
  wrongSlug,
} from "../migrations/0033_sanity_evening_slug.ts";
import { Events } from "../src/events.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * migrations/0033_sanity_evening_slug.ts on a database holding the evening
 * as production did: its long slug dated 2014, its short link given.
 */

const id = "e0000000-0000-4000-8000-000000000702";

const db = await seededDatabase();
afterAll(() => db.close());

await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_hackathon, is_draft, updated_at) VALUES
    ('${id}', '${wrongSlug}', 'React Bay Area at Sanity', '', '2024-07-31T00:00:00Z', '2024-07-31T03:00:00Z', 100, false, false, '2024-08-01T00:00:00Z');
  INSERT INTO event_slugs (slug, event_id) VALUES ('react-bay-area', '${id}');
  UPDATE events SET short_slug = 'react-bay-area' WHERE id = '${id}';
`);

const migrate = () =>
  Effect.runPromise(migration.pipe(Effect.provide(sqlLayer(db))));

const found = (slug: string) =>
  Effect.runPromise(
    Events.use((events) => events.getPublished(slug)).pipe(
      Effect.provide(
        Events.layer.pipe(
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockAt(now)),
        ),
      ),
    ),
  );

const links = async () =>
  (
    await db.query<{ slug: string }>(
      `SELECT slug FROM event_slugs WHERE event_id = $1 ORDER BY slug`,
      [id],
    )
  ).rows.map((row) => row.slug);

const stored = async () =>
  (
    await db.query<{ slug: string; short_slug: string; changed: boolean }>(
      `SELECT slug, short_slug, updated_at > '2024-08-01T00:00:00Z' AS changed
       FROM events WHERE id = $1`,
      [id],
    )
  ).rows;

describe("0033_sanity_evening_slug", () => {
  test("dates the long slug 2024 and keeps the 2014 one as a link the evening had", async () => {
    await migrate();
    expect(await stored()).toEqual([
      { slug: rightSlug, short_slug: "react-bay-area", changed: true },
    ]);
    expect(await links()).toEqual([wrongSlug, "react-bay-area"]);
  });

  test("every address the evening had still finds it, under its 2024 slug", async () => {
    for (const slug of [wrongSlug, rightSlug, "react-bay-area"]) {
      const event = await found(slug);
      expect([slug, event.id, event.slug]).toEqual([slug, id, rightSlug]);
    }
  });

  test("changes nothing on a second run", async () => {
    await migrate();
    expect(await stored()).toEqual([
      { slug: rightSlug, short_slug: "react-bay-area", changed: true },
    ]);
    expect(await links()).toEqual([wrongSlug, "react-bay-area"]);
  });
});
