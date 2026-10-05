import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Schema } from "effect";
import { sanitizeRichText } from "../src/rich-text.ts";
import {
  applyEventExtras,
  EventExtras,
  EventExtrasError,
  repeatedSlugs,
} from "../src/event-extras.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Applying events' schedules and notes: against tests/seed.sql, and the file
 * this branch carries, which must decode and say only what pages may show.
 */

const sources = ["https://allthingsweb.dev/2026-10-03-hack-day"];

const extras: EventExtras = {
  events: [
    {
      slug: "2026-10-03-hack-day",
      schedule: [
        { time: "9 am", title: "Doors open", description: "Form teams." },
        { time: "1 - 7 pm", title: "Hacking time", description: "" },
      ],
      notes: [
        { label: "Awards", body: "<p>Swag &amp; credits</p>" },
        { label: "Theme", body: "<p>Open source</p>" },
      ],
      sources,
    },
  ],
};

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

const database = async () => {
  const db = await seededDatabase();
  opened.push(db);
  return db;
};

const apply = (db: PGlite, file: EventExtras, dryRun = false) =>
  Effect.runPromise(
    applyEventExtras(file, dryRun).pipe(Effect.provide(sqlLayer(db))),
  );

const applyExit = (db: PGlite, file: EventExtras) =>
  Effect.runPromiseExit(
    applyEventExtras(file, false).pipe(Effect.provide(sqlLayer(db))),
  );

/** Hack day's schedule and notes, as stored. */
const stored = async (db: PGlite) => ({
  schedule: (
    await db.query(
      `SELECT position, time, title, description FROM event_schedule_items
       WHERE event_id = 'e0000000-0000-4000-8000-000000000003' ORDER BY position`,
    )
  ).rows,
  notes: (
    await db.query(
      `SELECT position, label, body FROM event_notes
       WHERE event_id = 'e0000000-0000-4000-8000-000000000003' ORDER BY position`,
    )
  ).rows,
});

describe("applying event extras", () => {
  test("writes each event's schedule and notes in the file's order", async () => {
    const db = await database();
    const applied = await apply(db, extras);
    expect(applied.lines).toEqual([
      "2026-10-03-hack-day: written (2 schedule items; notes: Awards, Theme; was 0 schedule items, 0 notes)",
    ]);
    expect(await stored(db)).toEqual({
      schedule: [
        {
          position: 0,
          time: "9 am",
          title: "Doors open",
          description: "Form teams.",
        },
        {
          position: 1,
          time: "1 - 7 pm",
          title: "Hacking time",
          description: "",
        },
      ],
      notes: [
        { position: 0, label: "Awards", body: "<p>Swag &amp; credits</p>" },
        { position: 1, label: "Theme", body: "<p>Open source</p>" },
      ],
    });
  });

  test("a second run changes nothing", async () => {
    const db = await database();
    await apply(db, extras);
    const before = await db.query(
      `SELECT updated_at FROM event_notes ORDER BY position`,
    );
    const again = await apply(db, extras);
    expect(again.lines).toEqual([
      "2026-10-03-hack-day: unchanged (2 schedule items; notes: Awards, Theme)",
    ]);
    expect(
      (await db.query(`SELECT updated_at FROM event_notes ORDER BY position`))
        .rows,
    ).toEqual(before.rows);
  });

  test("replaces what the event had with the file's, fewer rows included", async () => {
    const db = await database();
    await apply(db, extras);
    const [event] = extras.events;
    if (event === undefined) throw new Error("no event");
    await apply(db, {
      events: [
        {
          ...event,
          schedule: [{ time: "10 am", title: "Doors open", description: "" }],
          notes: [],
        },
      ],
    });
    expect(await stored(db)).toEqual({
      schedule: [
        { position: 0, time: "10 am", title: "Doors open", description: "" },
      ],
      notes: [],
    });
  });

  test("a dry run does everything, then rolls back", async () => {
    const db = await database();
    const applied = await apply(db, extras, true);
    expect(applied.lines.at(-1)).toBe("Dry run: rolled back.");
    expect(applied.lines[0]).toStartWith("2026-10-03-hack-day: written");
    expect(await stored(db)).toEqual({ schedule: [], notes: [] });
  });

  test("an unknown slug stops the run, writing nothing", async () => {
    const db = await database();
    const exit = await applyExit(db, {
      events: [...extras.events, { ...extras.events[0]!, slug: "nope" }],
    });
    expect(exit).toEqual(
      Exit.fail(new EventExtrasError({ reason: "No event has the slug nope" })),
    );
    expect(await stored(db)).toEqual({ schedule: [], notes: [] });
  });

  test("a slug named twice stops the run", async () => {
    const db = await database();
    const twice = { events: [...extras.events, ...extras.events] };
    expect(repeatedSlugs(twice)).toEqual(["2026-10-03-hack-day"]);
    const exit = await applyExit(db, twice);
    expect(exit).toEqual(
      Exit.fail(
        new EventExtrasError({
          reason: "Events named twice: 2026-10-03-hack-day",
        }),
      ),
    );
  });
});

describe("the file's shape", () => {
  const decodes = (event: unknown) =>
    Schema.decodeUnknownExit(EventExtras)({ events: [event] })._tag ===
    "Success";
  const valid = {
    slug: "2026-10-03-hack-day",
    schedule: [{ time: "9 am", title: "Doors open", description: "" }],
    notes: [{ label: "Awards", body: "<p>Swag</p>" }],
    sources,
  };

  test("takes what says something", () => {
    expect(decodes(valid)).toBe(true);
  });

  test.each([
    [
      "a blank time",
      { ...valid, schedule: [{ ...valid.schedule[0], time: "  " }] },
    ],
    [
      "a blank title",
      { ...valid, schedule: [{ ...valid.schedule[0], title: " " }] },
    ],
    [
      "a blank label",
      { ...valid, notes: [{ ...valid.notes[0], label: "\t" }] },
    ],
    [
      "a padded label",
      { ...valid, notes: [{ ...valid.notes[0], label: " Awards" }] },
    ],
    ["a blank body", { ...valid, notes: [{ ...valid.notes[0], body: "\n" }] }],
    ["a blank slug", { ...valid, slug: " " }],
  ])("refuses %s", (_, event) => {
    expect(decodes(event)).toBe(false);
  });
});

describe("core/backfill/event-extras.json", () => {
  const file = async () =>
    Schema.decodeUnknownSync(Schema.fromJsonString(EventExtras))(
      await Bun.file(
        new URL("../backfill/event-extras.json", import.meta.url),
      ).text(),
    );

  test("decodes, and names each event once", async () => {
    const decoded = await file();
    expect(decoded.events.map((event) => event.slug)).toEqual([
      "2024-10-05-hackathon-at-sentry",
      "2025-04-26-hackathon-at-sentry",
      "2025-06-02-nextdevfm-live",
      "2025-09-23-lightning-hackathon-at-sentry",
    ]);
    expect(repeatedSlugs(decoded)).toEqual([]);
  });

  test("keeps every word of its notes through sanitizing", async () => {
    for (const event of (await file()).events) {
      for (const note of event.notes) {
        const safe = await Effect.runPromise(sanitizeRichText(note.body));
        // Sanitizing only adds target and rel to links.
        expect(
          safe.replaceAll(' target="_blank" rel="noopener noreferrer"', ""),
        ).toBe(note.body);
      }
    }
  });
});
