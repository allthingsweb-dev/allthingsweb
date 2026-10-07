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
  roleAppearances,
  soonestFirst,
  talkAppearances,
} from "../src/catalog.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The catalog's fragments against the migrated schema, and against their
 * twin in code: an evening is ahead in SQL exactly when eventStatus says
 * it isn't past, at every instant around its start and end.
 */

/**
 * The seed, plus two evenings that start together, attached out of id
 * order, and the upcoming one shared: someone else's we list.
 */
const db = await seededDatabase();
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_hackathon, is_draft, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000402', '2027-01-01-tie-b', 'Tie B', '', '2027-01-01T02:00:00Z', '2027-01-01T05:00:00Z', 10, false, false, now()),
    ('e0000000-0000-4000-8000-000000000401', '2027-01-01-tie-a', 'Tie A', '', '2027-01-01T02:00:00Z', '2027-01-01T05:00:00Z', 10, false, false, now());
  INSERT INTO sponsors (id, name, about, updated_at) VALUES
    ('c0000000-0000-4000-8000-000000000900', 'Mastra', '', now());
  UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
    WHERE slug = '2026-11-05-upcoming';
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

describe("appearances", () => {
  // Ends now (Zed's lightning talk) ends at 19:00 on 3 October; React at Acme
  // and Café night are over; the draft's talk never counts.
  const lastInstant = at("2026-10-03T19:00:00Z");

  const speakers = (scope: Parameters<typeof talkAppearances>[1]) =>
    withSql(
      (sql) => sql<{ name: string }>`
        SELECT DISTINCT p.name FROM ${talkAppearances(sql, scope)} a
        JOIN profiles p ON p.id = a.profile_id
        ORDER BY p.name`,
    ).then((rows) => rows.map((row) => row.name));

  test("talks at any published evening, never a draft's", async () => {
    expect(await speakers({ whose: "any", when: "any" })).toEqual([
      "Ada Lovelace",
      "Future Speaker",
      "Grace Hopper",
      "Linus",
      "Zed Nobody",
    ]);
  });

  test("ended leaves out an evening at its last instant; endedOrEnding counts it", async () => {
    const over = ["Ada Lovelace", "Grace Hopper", "Linus"];
    expect(
      await speakers({ whose: "any", when: { ended: lastInstant } }),
    ).toEqual(over);
    expect(
      await speakers({ whose: "any", when: { endedOrEnding: lastInstant } }),
    ).toEqual([...over, "Zed Nobody"]);
  });

  test("ours leaves out the evenings we share", async () => {
    // Future Speaker's evening is the one shared.
    expect(await speakers({ whose: "ours", when: "any" })).not.toContain(
      "Future Speaker",
    );
    expect(await speakers({ whose: "any", when: "any" })).toContain(
      "Future Speaker",
    );
  });

  test("parts in evenings as a whole, by the same scope", async () => {
    await db.exec(`
      INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
        ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000007', 'co-host', 0, 'site', now()),
        ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'mc', 0, 'site', now());
    `);
    const rows = await withSql(
      (sql) => sql<{ name: string; role: string }>`
        SELECT p.name, a.role FROM ${roleAppearances(sql, { whose: "ours", when: { ended: lastInstant } })} a
        JOIN profiles p ON p.id = a.profile_id`,
    );
    expect(rows).toEqual([{ name: "Linus", role: "mc" }]);
  });
});
