import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import {
  ahead,
  ended,
  eventStatus,
  latestFirst,
  ours,
  published,
  soonestFirst,
} from "../src/catalog.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The catalog's fragments against the migrated schema, and against their
 * twin in code: an evening is ahead in SQL exactly when eventStatus says
 * it isn't past, at every instant around its start and end.
 */

/** The seed, plus two evenings that start together, attached out of id order. */
const db = await seededDatabase();
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_hackathon, is_draft, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000402', '2027-01-01-tie-b', 'Tie B', '', '2027-01-01T02:00:00Z', '2027-01-01T05:00:00Z', 10, false, false, now()),
    ('e0000000-0000-4000-8000-000000000401', '2027-01-01-tie-a', 'Tie A', '', '2027-01-01T02:00:00Z', '2027-01-01T05:00:00Z', 10, false, false, now());
`);
afterAll(() => db.close());

/** Runs `query` with the database's client. */
const withSql = <A>(
  query: (sql: SqlClient) => Effect.Effect<A, unknown>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* query(yield* SqlClient);
    }).pipe(Effect.provide(sqlLayer(db))),
  );

const at = (iso: string) => DateTime.makeUnsafe(iso);

/** React at Acme: from 01:00 to 04:00 UTC on 13 August 2026. */
const acme = {
  id: "e0000000-0000-4000-8000-000000000001",
  startDate: at("2026-08-13T01:00:00Z"),
  endDate: at("2026-08-13T04:00:00Z"),
};

describe("eventStatus", () => {
  test.each([
    ["2026-08-13T00:59:59.999Z", "upcoming"],
    ["2026-08-13T01:00:00.000Z", "live"],
    ["2026-08-13T04:00:00.000Z", "live"],
    ["2026-08-13T04:00:00.001Z", "past"],
  ] as const)("at %s it is %s", (now, status) => {
    expect(eventStatus(acme, at(now))).toBe(status);
  });
});

describe("ahead and ended", () => {
  test.each([
    "2026-08-13T00:59:59.999Z",
    "2026-08-13T01:00:00.000Z",
    "2026-08-13T03:59:59.999Z",
    "2026-08-13T04:00:00.000Z",
    "2026-08-13T04:00:00.001Z",
  ])("agree with eventStatus at %s", async (iso) => {
    const now = at(iso);
    const rows = await withSql(
      (sql) => sql<{ ahead: boolean; ended: boolean }>`
        SELECT ${ahead(sql, "e", now)} AS ahead, ${ended(sql, "e", now)} AS ended
        FROM events e WHERE e.id = ${acme.id}`,
    );
    const past = eventStatus(acme, now) === "past";
    expect(rows).toEqual([{ ahead: !past, ended: past }]);
  });
});

describe("published, ours and their order", () => {
  const slugs = (order: "soonest" | "latest") =>
    withSql((sql) =>
      sql<{ slug: string }>`
        SELECT e.slug FROM events e
        WHERE ${published(sql, "e")}
        ORDER BY ${order === "soonest" ? soonestFirst(sql, "e") : latestFirst(sql, "e")}`.pipe(
        Effect.map((rows) => rows.map((row) => row.slug)),
      ),
    );

  test("drafts are never published, and ids break ties either way", async () => {
    const soonest = await slugs("soonest");
    expect(soonest).not.toContain("2026-09-01-draft-night");
    expect(soonest).toEqual([
      "2025-12-02-café-night",
      "2026-08-12-react-at-acme",
      "2026-10-03-ends-now",
      "2026-10-03-hack-day",
      "2026-11-05-upcoming",
      "2027-01-01-tie-a",
      "2027-01-01-tie-b",
    ]);
    expect(await slugs("latest")).toEqual([
      "2027-01-01-tie-a",
      "2027-01-01-tie-b",
      "2026-11-05-upcoming",
      "2026-10-03-hack-day",
      "2026-10-03-ends-now",
      "2026-08-12-react-at-acme",
      "2025-12-02-café-night",
    ]);
  });

  test("ours leaves out the evenings we share", async () => {
    await db.exec(`
      INSERT INTO sponsors (id, name, about, updated_at) VALUES
        ('c0000000-0000-4000-8000-000000000900', 'Mastra', '', now());
      UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
        WHERE slug = '2026-11-05-upcoming';
    `);
    const rows = await withSql(
      (sql) => sql<{ slug: string }>`
        SELECT e.slug FROM events e
        WHERE ${published(sql, "e")} AND ${ours(sql, "e")}
        ORDER BY ${soonestFirst(sql, "e")}`,
    );
    expect(rows.map((row) => row.slug)).toEqual([
      "2025-12-02-café-night",
      "2026-08-12-react-at-acme",
      "2026-10-03-ends-now",
      "2026-10-03-hack-day",
      "2027-01-01-tie-a",
      "2027-01-01-tie-b",
    ]);
  });
});
