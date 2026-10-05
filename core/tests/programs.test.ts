import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Schema } from "effect";
import {
  applyPrograms,
  Programs,
  ProgramsError,
  repeatedSlugs,
} from "../src/programs.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Applying what kind of evening each event was: against tests/seed.sql, and
 * the file this branch carries, which must decode and name each event once.
 */

const sources = ["https://lu.ma/event/evt-react"];

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

const database = async () => {
  const db = await seededDatabase();
  opened.push(db);
  return db;
};

const apply = (db: PGlite, file: Programs, dryRun = false) =>
  Effect.runPromise(
    applyPrograms(file, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const applyExit = (db: PGlite, file: Programs) =>
  Effect.runPromiseExit(
    applyPrograms(file, false).pipe(Effect.provide(sqlLayer(db))),
  );

/** Each event's program and is_hackathon, by slug. */
const stored = async (db: PGlite) =>
  Object.fromEntries(
    (
      await db.query<{ slug: string; program: string; is_hackathon: boolean }>(
        `SELECT slug, program, is_hackathon FROM events ORDER BY slug`,
      )
    ).rows.map((row) => [row.slug, `${row.program} ${row.is_hackathon}`]),
  );

const file: Programs = {
  events: [
    { slug: "2026-08-12-react-at-acme", program: "talks", sources },
    {
      slug: "2025-12-02-café-night",
      program: "social",
      note: "coffee",
      sources,
    },
    { slug: "2026-11-05-upcoming", program: "hackathon", sources },
    { slug: "2026-10-03-hack-day", program: "open-floor", sources },
  ],
};

describe("applying programs", () => {
  test("writes each program, and is_hackathon with it", async () => {
    const db = await database();
    const applied = await apply(db, file);
    expect(applied.lines).toEqual([
      "2026-08-12-react-at-acme: talks, unchanged",
      "2025-12-02-café-night: social (was talks)",
      "2026-11-05-upcoming: hackathon (was talks)",
      "2026-10-03-hack-day: open-floor (was hackathon)",
      "not in the file: 2026-09-01-draft-night (talks)",
      "not in the file: 2026-10-03-ends-now (talks)",
    ]);
    expect(await stored(db)).toEqual({
      "2025-12-02-café-night": "social false",
      "2026-08-12-react-at-acme": "talks false",
      "2026-09-01-draft-night": "talks false",
      "2026-10-03-ends-now": "talks false",
      "2026-10-03-hack-day": "open-floor false",
      "2026-11-05-upcoming": "hackathon true",
    });
  });

  test("a second run changes nothing", async () => {
    const db = await database();
    await apply(db, file);
    const again = await apply(db, file);
    expect(again.lines.slice(0, 4)).toEqual([
      "2026-08-12-react-at-acme: talks, unchanged",
      "2025-12-02-café-night: social, unchanged",
      "2026-11-05-upcoming: hackathon, unchanged",
      "2026-10-03-hack-day: open-floor, unchanged",
    ]);
  });

  test("a dry run does everything, then rolls back", async () => {
    const db = await database();
    const before = await stored(db);
    const applied = await apply(db, file, true);
    expect(applied.lines.at(-1)).toBe("Dry run: rolled back.");
    expect(await stored(db)).toEqual(before);
  });

  test("an unknown slug stops the run, writing nothing", async () => {
    const db = await database();
    const before = await stored(db);
    const exit = await applyExit(db, {
      events: [...file.events, { slug: "nope", program: "talks", sources }],
    });
    expect(exit).toEqual(
      Exit.fail(new ProgramsError({ reason: "No event has the slug nope" })),
    );
    expect(await stored(db)).toEqual(before);
  });

  test("a slug named twice stops the run", async () => {
    const db = await database();
    const twice = { events: [...file.events, ...file.events] };
    expect(repeatedSlugs(twice)).toHaveLength(4);
    const exit = await applyExit(db, twice);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("the database refuses a hackathon flag that disagrees with the program", async () => {
    const db = await database();
    await expect(
      db.exec(
        `UPDATE events SET is_hackathon = true WHERE slug = '2026-08-12-react-at-acme'`,
      ),
    ).rejects.toThrow("events_program_hackathon_check");
    await expect(
      db.exec(
        `UPDATE events SET program = 'party' WHERE slug = '2026-08-12-react-at-acme'`,
      ),
    ).rejects.toThrow("events_program_check");
  });
});

describe("core/backfill/programs.json", () => {
  const decoded = async () =>
    Schema.decodeUnknownSync(Schema.fromJsonString(Programs))(
      await Bun.file(
        new URL("../backfill/programs.json", import.meta.url),
      ).text(),
    );

  test("decodes, and names each event once", async () => {
    const programs = await decoded();
    expect(repeatedSlugs(programs)).toEqual([]);
    expect(programs.events).toHaveLength(37);
  });

  test("says why wherever an evening had no lineup", async () => {
    for (const event of (await decoded()).events) {
      if (event.program === "open-floor" || event.program === "social") {
        expect(event.note).toBeDefined();
      }
    }
  });
});
