import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Schema } from "effect";
import {
  applyCuration,
  CurationError,
  CurationFile,
  repeated,
} from "../src/curation.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Marking evenings we share but don't host: against tests/seed.sql, and the
 * file this branch carries, which must decode and name each thing once.
 */

const sources = ["https://luma.com/example"];

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

const database = async () => {
  const db = await seededDatabase();
  opened.push(db);
  return db;
};

const apply = (db: PGlite, file: CurationFile, dryRun = false) =>
  Effect.runPromise(
    applyCuration(file, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const applyExit = (db: PGlite, file: CurationFile) =>
  Effect.runPromiseExit(
    applyCuration(file, false).pipe(Effect.provide(sqlLayer(db))),
  );

/** Each event's curation and organizer, by slug. */
const stored = async (db: PGlite) =>
  Object.fromEntries(
    (
      await db.query<{
        slug: string;
        curation: string;
        organizer: string | null;
      }>(
        `SELECT e.slug, e.curation, s.name AS organizer
         FROM events e LEFT JOIN sponsors s ON s.id = e.organized_by
         ORDER BY e.slug`,
      )
    ).rows.map((row) => [row.slug, `${row.curation} ${row.organizer ?? "-"}`]),
  );

const file: CurationFile = {
  organizers: [
    {
      name: "Mastra",
      about: "Agents in TypeScript.",
      website: "https://mastra.ai",
      twitterHandle: "mastra",
      sources,
    },
  ],
  events: [
    { slug: "2026-11-05-upcoming", organizer: "Mastra", sources },
    // Acme is a hosting company already: used as it is.
    { slug: "2025-12-02-café-night", organizer: "Acme", sources },
  ],
};

describe("applying curation", () => {
  test("adds the organizer, and marks each event shared by its organizer", async () => {
    const db = await database();
    expect(await apply(db, file)).toEqual([
      "organizer Mastra: added",
      "2026-11-05-upcoming: shared by Mastra (was ours)",
      "2025-12-02-café-night: shared by Acme (was ours)",
    ]);
    expect(await stored(db)).toMatchObject({
      "2026-11-05-upcoming": "shared Mastra",
      "2025-12-02-café-night": "shared Acme",
      "2026-08-12-react-at-acme": "ours -",
    });
    const [mastra] = (
      await db.query<{ website_url: string; twitter_handle: string }>(
        `SELECT website_url, twitter_handle FROM sponsors WHERE name = 'Mastra'`,
      )
    ).rows;
    expect(mastra).toEqual({
      website_url: "https://mastra.ai",
      twitter_handle: "mastra",
    });
  });

  test("a second run changes nothing", async () => {
    const db = await database();
    await apply(db, file);
    expect(await apply(db, file)).toEqual([
      "organizer Mastra: already there, kept as it is",
      "2026-11-05-upcoming: shared by Mastra, unchanged",
      "2025-12-02-café-night: shared by Acme, unchanged",
    ]);
  });

  test("lists shared evenings the file doesn't name, and leaves them", async () => {
    const db = await database();
    await apply(db, file);
    const [first] = file.events;
    if (first === undefined) throw new Error("no event");
    const lines = await apply(db, { organizers: [], events: [first] });
    expect(lines).toContain("shared, not in the file: 2025-12-02-café-night");
    expect((await stored(db))["2025-12-02-café-night"]).toBe("shared Acme");
  });

  test("a dry run does everything, then rolls back", async () => {
    const db = await database();
    const before = await stored(db);
    const lines = await apply(db, file, true);
    expect(lines.at(-1)).toBe("Dry run: rolled back.");
    expect(await stored(db)).toEqual(before);
  });

  test("an unknown slug or organizer stops the run, writing nothing", async () => {
    const db = await database();
    const before = await stored(db);
    expect(
      await applyExit(db, {
        organizers: [],
        events: [{ slug: "2026-11-05-upcoming", organizer: "Nobody", sources }],
      }),
    ).toEqual(
      Exit.fail(
        new CurationError({
          reason: "2026-11-05-upcoming: no organizer named Nobody",
        }),
      ),
    );
    expect(
      await applyExit(db, {
        organizers: [],
        events: [{ slug: "nope", organizer: "Acme", sources }],
      }),
    ).toEqual(
      Exit.fail(new CurationError({ reason: "No event has the slug nope" })),
    );
    expect(await stored(db)).toEqual(before);
  });

  test("the database holds a shared event to having an organizer, and only it", async () => {
    const db = await database();
    await expect(
      db.exec(
        `UPDATE events SET curation = 'shared' WHERE slug = '2026-11-05-upcoming'`,
      ),
    ).rejects.toThrow("events_curation_organizer_check");
    await expect(
      db.exec(
        `UPDATE events SET organized_by = (SELECT id FROM sponsors LIMIT 1) WHERE slug = '2026-11-05-upcoming'`,
      ),
    ).rejects.toThrow("events_curation_organizer_check");
  });
});

describe("core/backfill/curation.json", () => {
  test("decodes, names each thing once, and shares TypeScript AI Demo Day by Mastra", async () => {
    const decoded = Schema.decodeUnknownSync(
      Schema.fromJsonString(CurationFile),
    )(
      await Bun.file(
        new URL("../backfill/curation.json", import.meta.url),
      ).text(),
    );
    expect(repeated(decoded)).toEqual([]);
    expect(
      decoded.events.map((event) => [event.slug, event.organizer]),
    ).toEqual([
      ["2026-04-09-typescript-ai-demo-day-evt-IpKgpcPJEOjvroH", "Mastra"],
    ]);
  });
});
