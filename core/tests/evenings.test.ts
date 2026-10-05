import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { DataSourceError } from "../src/errors.ts";
import { Evenings, type EveningsView } from "../src/evenings.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Evenings against the migrated production schema and tests/seed.sql, plus
 * an evening that starts with another, so ties show.
 */

const db = await seededDatabase();
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, topic, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000108', '2026-11-05-same-start', 'Same start', '', '2026-11-06T02:00:00Z', '2026-11-06T05:00:00Z', 100, '45 Fremont St', NULL, NULL, NULL, false, false, NULL, now());
`);
afterAll(() => db.close());

const read = (at: DateTime.Utc = now): Promise<EveningsView> =>
  Effect.runPromise(
    Effect.provide(
      Evenings.use((repository) => repository.read),
      Evenings.layer.pipe(
        Layer.provideMerge(sqlLayer(db)),
        Layer.provideMerge(clockAt(at)),
      ),
    ),
  );

const at = (iso: string) => DateTime.makeUnsafe(iso);
const slugs = (evenings: ReadonlyArray<{ readonly slug: string }>) =>
  evenings.map((evening) => evening.slug);

describe("Evenings", () => {
  test("lists every evening still ahead, soonest first, ids breaking ties", async () => {
    const { ahead } = await read();
    expect(slugs(ahead)).toEqual([
      "2026-10-03-ends-now",
      "2026-10-03-hack-day",
      "2026-11-05-upcoming",
      "2026-11-05-same-start",
    ]);
    expect(ahead.map((evening) => evening.status)).toEqual([
      "live",
      "live",
      "upcoming",
      "upcoming",
    ]);
  });

  test("lists every evening that has ended, latest first", async () => {
    const { past } = await read();
    expect(slugs(past)).toEqual([
      "2026-08-12-react-at-acme",
      "2025-12-02-café-night",
    ]);
    expect(past.every((evening) => evening.status === "past")).toBe(true);
  });

  test("moves an evening to the past the minute after it ends: pages read as of the minute", async () => {
    // Ends now ends at 19:00:00; through 19:00:59.999 the page reads as of 19:00.
    const sameMinute = await read(at("2026-10-03T19:00:59.999Z"));
    expect(slugs(sameMinute.ahead)[0]).toBe("2026-10-03-ends-now");
    const after = await read(at("2026-10-03T19:01:00.000Z"));
    expect(slugs(after.ahead)[0]).toBe("2026-10-03-hack-day");
    expect(slugs(after.past)[0]).toBe("2026-10-03-ends-now");
  });

  test("reads each evening as home does: topic, neighborhood, hosts, Luma page", async () => {
    const { past, ahead } = await read();
    expect(past[0]).toEqual({
      slug: "2026-08-12-react-at-acme",
      name: "React at Acme",
      topic: "react",
      status: "past",
      startsAt: at("2026-08-13T01:00:00Z"),
      neighborhood: null,
      hosts: ["Globex", "Acme"],
      rsvpUrl: "https://lu.ma/event/evt-react",
    });
    expect(
      ahead.find((evening) => evening.slug === "2026-11-05-same-start"),
    ).toMatchObject({ neighborhood: "FiDi", topic: "same start" });
  });

  test("never lists a draft, before or after it happens", async () => {
    for (const iso of ["2026-08-20T00:00:00Z", "2026-09-10T00:00:00Z"]) {
      const { ahead, past } = await read(at(iso));
      expect([...slugs(ahead), ...slugs(past)]).not.toContain(
        "2026-09-01-draft-night",
      );
    }
  });

  test("lists every published evening exactly once", async () => {
    const { ahead, past } = await read();
    const all = [...slugs(ahead), ...slugs(past)];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(6);
  });

  test("fails as a DataSourceError when the database can't be read", async () => {
    const database = await seededDatabase();
    await database.close();
    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          Evenings.use((repository) => repository.read),
          Evenings.layer.pipe(
            Layer.provideMerge(sqlLayer(database)),
            Layer.provideMerge(clockAt(now)),
          ),
        ),
      ),
    );
    expect(failure).toBeInstanceOf(DataSourceError);
  });
});
