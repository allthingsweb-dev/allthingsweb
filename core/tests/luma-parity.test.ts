import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Exit, Layer } from "effect";
import {
  allThingsWebCalendarId,
  locationPlaceholderPattern,
} from "../src/luma/feed.ts";
import { Luma } from "../src/luma/luma.ts";
import { LumaSync, type SyncSummary } from "../src/luma/sync.ts";
import { venueArchive } from "../src/luma/venue-archive.ts";
import { clockAt, migratedDatabase, sqlLayer } from "./support/database.ts";
import {
  configFrom,
  fakeLuma,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

/**
 * Runs the app's hourly Luma sync (app/src/lib/luma/sync.ts, on drizzle's
 * PGlite driver) and core's LumaSync on two copies of one database, each fed
 * the same Luma response, at the same time, and requires the same database
 * afterwards, row for row, in every table, and the same summary.
 *
 * Time is frozen for the app (bun's setSystemTime, which PGlite's now() follows
 * too) at the instant core's TestClock reads, so created_at and updated_at
 * agree. Only one value may differ: the id Postgres generates for an event the
 * sync creates (gen_random_uuid()). Those are compared as "<generated>".
 *
 * The app is loaded at runtime, as in tests/parity.test.ts: its own compiler
 * checks it. Its fetch is replaced for the run; nothing reaches Luma.
 */

const app = new URL("../../app/", import.meta.url);
const load = (path: string): Promise<unknown> =>
  import(new URL(path, app).href);
const appPackage = (name: string): Promise<unknown> =>
  import(Bun.resolveSync(name, app.pathname));

const { syncPublicLumaEvents } = (await load("src/lib/luma/sync.ts")) as {
  syncPublicLumaEvents: (
    database: unknown,
    calendarId?: string,
  ) => Promise<SyncSummary>;
};
const appCalendar = (await load("src/lib/luma/public-calendar.ts")) as {
  ALL_THINGS_WEB_CALENDAR_ID: string;
  LUMA_LOCATION_PLACEHOLDER_PATTERN: string;
};
const { drizzle } = (await appPackage("drizzle-orm/pglite")) as {
  drizzle: (config: { client: unknown }) => unknown;
};

const calendar = await fixture("calendar.ics");
const stored = await fixture("stored.sql");

/** One sync: what Luma answers, and when. */
interface Run {
  readonly at: string;
  /** The app reads only the first: it does not retry. */
  readonly replies: ReadonlyArray<Reply>;
  readonly env?: Record<string, string>;
}

type Outcome =
  | { readonly ok: true; readonly summary: SyncSummary }
  | { readonly ok: false };

interface Sent {
  readonly url: string;
  readonly accept: string | undefined;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
});

async function runApp(db: PGlite, run: Run) {
  const sent: Array<Sent> = [];
  const reply = run.replies[0];
  if (reply === undefined || reply === "hang") {
    throw new Error("The app's run needs a reply it can read.");
  }
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        accept: new Headers(init?.headers).get("accept") ?? undefined,
      });
      if (reply === "drop") throw new TypeError("fetch failed");
      return new Response(reply.body ?? "", {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  setSystemTime(new Date(run.at));
  try {
    const summary = await syncPublicLumaEvents(
      drizzle({ client: db }),
      run.env?.["LUMA_CALENDAR_API_ID"],
    );
    return { outcome: { ok: true, summary } satisfies Outcome, sent };
  } catch {
    return { outcome: { ok: false } satisfies Outcome, sent };
  } finally {
    globalThis.fetch = originalFetch;
    setSystemTime();
  }
}

async function runCore(db: PGlite, run: Run) {
  const luma = fakeLuma(run.replies);
  const layer = LumaSync.layer.pipe(
    Layer.provide(
      Luma.layer.pipe(
        Layer.provide(Layer.mergeAll(luma.layer, configFrom(run.env))),
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockAt(DateTime.makeUnsafe(run.at))),
  );
  setSystemTime(new Date(run.at));
  try {
    const exit = await Effect.runPromiseExit(
      settle(LumaSync.use((sync) => sync.run)).pipe(Effect.provide(layer)),
    );
    const outcome: Outcome = Exit.isSuccess(exit)
      ? { ok: true, summary: exit.value }
      : { ok: false };
    return { outcome, sent: luma.requests };
  } finally {
    setSystemTime();
  }
}

/** Every row of every table in `public`, in a stable order. */
async function contents(db: PGlite, generated: (id: string) => boolean) {
  const tables = await db.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const result: Record<string, Array<unknown>> = {};
  for (const { name } of tables.rows) {
    const rows = await db.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM public.${name} t`,
    );
    result[name] = rows.rows
      .map(({ row }) =>
        name === "events" &&
        typeof row["id"] === "string" &&
        generated(row["id"])
          ? { ...row, id: "<generated>" }
          : row,
      )
      .toSorted((a, b) => {
        const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
        return x < y ? -1 : x > y ? 1 : 0;
      });
  }
  return result;
}

async function database(seed: string): Promise<PGlite> {
  const db = await migratedDatabase();
  if (seed !== "") await db.exec(seed);
  return db;
}

type Tables = Awaited<ReturnType<typeof contents>>;

/**
 * Runs `runs` on both sides, in order, from `seed`, comparing outcomes and
 * whole databases after each. Returns core's outcomes, and the database
 * before the first run and after each, for further checks.
 */
async function parity(seed: string, runs: ReadonlyArray<Run>) {
  const [appDb, coreDb] = await Promise.all([database(seed), database(seed)]);
  try {
    const seeded = new Set(
      (await appDb.query<{ id: string }>("SELECT id FROM events")).rows.map(
        ({ id }) => id,
      ),
    );
    const generated = (id: string) => !seeded.has(id);
    const outcomes: Array<Outcome> = [];
    const tables: Array<Tables> = [await contents(coreDb, generated)];
    for (const run of runs) {
      const appRun = await runApp(appDb, run);
      const coreRun = await runCore(coreDb, run);
      expect(coreRun.outcome).toEqual(appRun.outcome);
      // Both ask Luma the same thing (core may ask again).
      expect(coreRun.sent.length).toBeGreaterThanOrEqual(appRun.sent.length);
      for (const [index, request] of appRun.sent.entries()) {
        expect(coreRun.sent[index]).toMatchObject(request);
      }
      const after = await contents(coreDb, generated);
      expect(after).toEqual(await contents(appDb, generated));
      outcomes.push(coreRun.outcome);
      tables.push(after);
    }
    return { outcomes, tables };
  } finally {
    await Promise.all([appDb.close(), coreDb.close()]);
  }
}

const ok = (body: string): Reply => ({ body });

/** The `events` rows Luma knows, by Luma id. */
const lumaEvents = (tables: Tables | undefined) =>
  new Map(
    (tables?.["events"] ?? []).flatMap((row) => {
      const event = row as Record<string, unknown>;
      const id = event["luma_event_id"];
      return typeof id === "string" ? [[id, event] as const] : [];
    }),
  );

/** The Luma ids of the events whose rows differ between `a` and `b`. */
const changedBetween = (a: Tables | undefined, b: Tables | undefined) => {
  const [before, after] = [lumaEvents(a), lumaEvents(b)];
  return [...after.keys()]
    .filter((id) => !Bun.deepEquals(before.get(id), after.get(id)))
    .toSorted();
};

/** updated_at as `contents` reads it. */
const stamp = (iso: string) => iso.replace(/Z$/, "+00:00");

/** The calendar a month later: renamed, rescheduled, cancelled, moved. */
const later = calendar
  .replace(
    "SUMMARY:Venue to be announced",
    "SUMMARY:Venue announced\nLOCATION:Convex\\, 444 De Haro St\\, San Francisco",
  )
  .replace(
    "DTSTART:20261203T020000Z\nDTEND:20261203T050000Z",
    "DTSTART:20261204T020000Z\nDTEND:20261204T053000Z",
  )
  .replace(
    "SUMMARY:Online office hours",
    "SUMMARY:Online office hours\nSTATUS:CANCELLED",
  )
  .replace("CLASS:PRIVATE\n", "CLASS:PUBLIC\n");

describe("core's Luma sync writes what the app's writes", () => {
  test("the first sync of a whole calendar", async () => {
    const {
      outcomes: [outcome],
    } = await parity("", [
      { at: "2026-10-04T19:00:00Z", replies: [ok(calendar)] },
    ]);
    expect(outcome).toMatchObject({
      ok: true,
      summary: { syncedCount: 24, changedCount: 24, publishedCount: 21 },
    });
  });

  test("the same calendar served with CRLF line endings", async () => {
    await parity("", [
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(calendar.replaceAll("\n", "\r\n"))],
      },
    ]);
  });

  test("syncs over stored events: Luma's fields change, the site's stay, nothing is deleted", async () => {
    const { outcomes, tables } = await parity(stored, [
      { at: "2026-10-04T19:00:00Z", replies: [ok(calendar)] },
      // Again, unchanged: nothing is written, updated_at included.
      { at: "2026-10-04T20:00:00Z", replies: [ok(calendar)] },
      // A month on, Luma's calendar has changed.
      { at: "2026-11-04T20:00:00Z", replies: [ok(later)] },
    ]);
    expect(outcomes).toMatchObject([
      // Every event but the secret venue night, which is stored as Luma
      // shows it: Luma hides its venue and the stored one stays.
      { ok: true, summary: { syncedCount: 24, changedCount: 23 } },
      { ok: true, summary: { syncedCount: 24, changedCount: 0 } },
      { ok: true, summary: { syncedCount: 24, changedCount: 4 } },
    ]);
    const [seeded, first, second, third] = tables;
    const firstEvents = lumaEvents(first);
    // Written for their venue alone: the archive restores Meraki's, and an
    // unknown placeholder is cleared.
    for (const id of ["evt-HtDmTqndK1vA1Z4", "evt-blankVenue"]) {
      expect(firstEvents.get(id)?.["updated_at"]).toBe(
        stamp("2026-10-04T19:00:00Z"),
      );
    }
    expect(changedBetween(seeded, first)).not.toContain("evt-hiddenVenue");
    expect(second).toEqual(first);
    expect(changedBetween(second, third)).toEqual([
      "evt-hiddenVenue",
      "evt-noVenue",
      "evt-online",
      "evt-private",
    ]);
    for (const id of changedBetween(second, third)) {
      expect(lumaEvents(third).get(id)?.["updated_at"]).toBe(
        stamp("2026-11-04T20:00:00Z"),
      );
    }
  });

  test("a change to one of Luma's fields writes that event alone", async () => {
    const renamed = calendar.replace(
      "SUMMARY:Secret venue night",
      "SUMMARY:Secret venue night revealed",
    );
    const { outcomes, tables } = await parity(stored, [
      { at: "2026-10-04T19:00:00Z", replies: [ok(calendar)] },
      { at: "2026-10-04T20:00:00Z", replies: [ok(renamed)] },
    ]);
    expect(outcomes[1]).toMatchObject({
      ok: true,
      summary: { syncedCount: 24, changedCount: 1, publishedCount: 21 },
    });
    const [, first, second] = tables;
    expect(changedBetween(first, second)).toEqual(["evt-hiddenVenue"]);
    expect(lumaEvents(second).get("evt-hiddenVenue")).toEqual({
      ...lumaEvents(first).get("evt-hiddenVenue"),
      name: "Secret venue night revealed",
      updated_at: stamp("2026-10-04T20:00:00Z"),
    });
    // Nothing else moved, in any table.
    expect({ ...second, events: [] }).toEqual({ ...first, events: [] });
  });

  test("venues already restored, cleared or kept are not written again", async () => {
    // As the first sync leaves them: Meraki's placeholders restored from the
    // archive (its venue label edited by hand), the unknown one cleared.
    const settled = `${stored}
      UPDATE events SET street_address = '500 Terry A Francois Blvd',
        full_address = 'Cisco Meraki, 500 Terry A Francois Blvd, San Francisco, CA 94158'
      WHERE luma_event_id = 'evt-HtDmTqndK1vA1Z4';
      UPDATE events SET street_address = NULL, short_location = NULL, full_address = NULL
      WHERE luma_event_id = 'evt-blankVenue';`;
    const { outcomes, tables } = await parity(settled, [
      { at: "2026-10-04T19:00:00Z", replies: [ok(calendar)] },
    ]);
    expect(outcomes).toMatchObject([
      { ok: true, summary: { syncedCount: 24, changedCount: 21 } },
    ]);
    const changed = changedBetween(tables[0], tables[1]);
    for (const id of [
      "evt-HtDmTqndK1vA1Z4",
      "evt-blankVenue",
      "evt-hiddenVenue",
    ]) {
      expect(changed).not.toContain(id);
    }
  });

  test("a venue the organizers set stays, whatever Luma shows", async () => {
    // The organizers know where it really was; Luma later shows Convex.
    const ours = `${stored}
      UPDATE events SET street_address = 'The real place, 1 Real St',
        short_location = 'The real place',
        full_address = 'The real place, 1 Real St, San Francisco',
        venue_by_organizer = true
      WHERE luma_event_id = 'evt-noVenue';`;
    const { tables } = await parity(ours, [
      { at: "2026-10-04T19:00:00Z", replies: [ok(calendar)] },
      { at: "2026-11-04T20:00:00Z", replies: [ok(later)] },
    ]);
    for (const table of tables.slice(1)) {
      expect(lumaEvents(table).get("evt-noVenue")).toMatchObject({
        street_address: "The real place, 1 Real St",
        short_location: "The real place",
        full_address: "The real place, 1 Real St, San Francisco",
        venue_by_organizer: true,
      });
    }
  });

  test("a slug taken by a site-only event fails the whole sync", async () => {
    const { outcomes } = await parity(
      `INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, created_at, updated_at)
       VALUES ('e0000000-0000-4000-8000-000000000001', '2026-10-14-venue-to-be-announced-evt-noVenue', 'Taken', 'Taken', '2026-10-15T01:30:00Z', '2026-10-15T04:30:00Z', 10, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
      [{ at: "2026-10-04T19:00:00Z", replies: [ok(calendar)] }],
    );
    expect(outcomes).toEqual([{ ok: false }]);
  });

  test("a calendar of 150 events, which Luma serves whole: there are no pages", async () => {
    const events = Array.from({ length: 150 }, (_, index) => {
      const day = String((index % 28) + 1).padStart(2, "0");
      const month = String((index % 12) + 1).padStart(2, "0");
      return [
        "BEGIN:VEVENT",
        `UID:evt-bulk${index}@events.lu.ma`,
        `DTSTART:${2020 + (index % 7)}${month}${day}T020000Z`,
        `DTEND:${2020 + (index % 7)}${month}${day}T050000Z`,
        `SUMMARY:All Things Web #${index}`,
        index % 3 === 0 ? "STATUS:CANCELLED" : "LOCATION:Somewhere\\, SF",
        "END:VEVENT",
      ].join("\n");
    });
    const {
      outcomes: [outcome],
    } = await parity(stored, [
      {
        at: "2026-10-04T19:00:00Z",
        replies: [
          ok(
            `BEGIN:VCALENDAR\nVERSION:2.0\n${events.join("\n")}\nEND:VCALENDAR\n`,
          ),
        ],
      },
    ]);
    expect(outcome).toMatchObject({
      ok: true,
      summary: { syncedCount: 150, changedCount: 150, publishedCount: 100 },
    });
  });

  test("the calendar LUMA_CALENDAR_API_ID names", async () => {
    await parity("", [
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(calendar)],
        env: { LUMA_CALENDAR_API_ID: "cal-AnotherCalendar1" },
      },
    ]);
  });

  const event = (lines: string) =>
    `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${lines}\nEND:VEVENT\nEND:VCALENDAR\n`;
  const valid =
    "UID:evt-test@events.lu.ma\nSUMMARY:All Things Web\nDTSTART:20261016T013000Z\nDTEND:20261016T043000Z";

  test.each<[string, Run]>([
    [
      "Luma is down (core retries, then fails)",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [{ status: 503, body: "Unavailable" }],
      },
    ],
    [
      "Luma rate limits",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [{ status: 429, headers: { "retry-after": "2" } }],
      },
    ],
    ["the connection drops", { at: "2026-10-04T19:00:00Z", replies: ["drop"] }],
    [
      "Luma refuses",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [{ status: 404, body: "Not found" }],
      },
    ],
    [
      "an HTML page",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok("<html>Not a calendar</html>")],
      },
    ],
    [
      "a cut-off calendar",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(calendar.slice(0, calendar.length / 2))],
      },
    ],
    [
      "an empty calendar",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n")],
      },
    ],
    [
      "a calendar of another kind",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok("BEGIN:VCARD\nEND:VCARD\nEND:VCALENDAR\n")],
      },
    ],
    [
      "an event that is not Luma's",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [
          ok(
            calendar +
              event(
                valid.replace("evt-test@events.lu.ma", "evt-test@example.com"),
              ),
          ),
        ],
      },
    ],
    [
      "an event without a title",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [
          ok(event(valid.replace("SUMMARY:All Things Web", "SUMMARY:   "))),
        ],
      },
    ],
    [
      "an event without a start",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(event(valid.replace("DTSTART:20261016T013000Z\n", "")))],
      },
    ],
    [
      "an event that ends before it starts",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [
          ok(
            event(
              valid.replace("DTEND:20261016T043000Z", "DTEND:20261016T003000Z"),
            ),
          ),
        ],
      },
    ],
    [
      "an event without an end or a duration",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(event(valid.replace("\nDTEND:20261016T043000Z", "")))],
      },
    ],
    [
      "a malformed date",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [
          ok(
            event(valid.replace("DTEND:20261016T043000Z", "DTEND:2026-10-16")),
          ),
        ],
      },
    ],
    [
      "an unknown time zone",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [
          ok(
            event(
              valid.replace(
                "DTSTART:20261016T013000Z",
                "DTSTART;TZID=Mars/Olympus_Mons:20261016T013000",
              ),
            ),
          ),
        ],
      },
    ],
    [
      "a recurring event",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(event(`${valid}\nRRULE:FREQ=WEEKLY`))],
      },
    ],
    [
      "an occurrence of a recurring event",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(event(`${valid}\nRECURRENCE-ID:20261016T013000Z`))],
      },
    ],
    [
      "an invalid calendar id",
      {
        at: "2026-10-04T19:00:00Z",
        replies: [ok(calendar)],
        env: { LUMA_CALENDAR_API_ID: "not-a-calendar" },
      },
    ],
  ])("%s fails on both, writing nothing", async (_, run) => {
    const { outcomes } = await parity(stored, [run]);
    expect(outcomes).toEqual([{ ok: false }]);
  });
});

describe("core's Luma constants are the app's", () => {
  test("the calendar and the location placeholder", () => {
    expect(allThingsWebCalendarId).toBe(appCalendar.ALL_THINGS_WEB_CALENDAR_ID);
    expect(locationPlaceholderPattern).toBe(
      appCalendar.LUMA_LOCATION_PLACEHOLDER_PATTERN,
    );
  });

  test("the venue archive", async () => {
    const archive: unknown = await Bun.file(
      new URL("src/lib/luma/venue-archive.json", app),
    ).json();
    expect(venueArchive).toEqual(archive as typeof venueArchive);
  });
});
