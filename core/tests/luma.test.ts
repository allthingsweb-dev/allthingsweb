import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Duration, Effect, Exit, Layer } from "effect";
import { DataSourceError } from "../src/errors.ts";
import {
  type FeedEvent,
  LumaFeedError,
  parseCalendar,
} from "../src/luma/feed.ts";
import {
  Luma,
  LumaRejected,
  LumaUnavailable,
  retryAfter,
} from "../src/luma/luma.ts";
import {
  eventSlug,
  fillUnseen,
  LumaSync,
  toEventRow,
} from "../src/luma/sync.ts";
import { clockAt, migratedDatabase, sqlLayer } from "./support/database.ts";
import {
  configFrom,
  fakeLuma,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

const calendar = await fixture("calendar.ics");
const stored = await fixture("stored.sql");
const start = DateTime.makeUnsafe("2026-10-04T19:00:00Z");
const iso = (instant: DateTime.Utc) => DateTime.formatIso(instant);

const parse = (text: string) => Effect.runPromise(parseCalendar(text));
const parseError = (text: string) =>
  Effect.runPromise(Effect.flip(parseCalendar(text)));

const byId = async (text: string) =>
  new Map((await parse(text)).map((event) => [event.lumaEventId, event]));

const oneEvent = (lines: string) =>
  `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${lines}\nEND:VEVENT\nEND:VCALENDAR\n`;
const valid =
  "UID:evt-test@events.lu.ma\nSUMMARY:All Things Web\nDTSTART:20261016T013000Z\nDTEND:20261016T043000Z";

describe("reading the feed", () => {
  test("reads each event once, in the order first listed", async () => {
    const events = await parse(calendar);
    expect(events).toHaveLength(24);
    expect(events.map((event) => event.lumaEventId).slice(0, 3)).toEqual([
      "evt-pastSentry24",
      "evt-vercelNov26",
      "evt-HtDmTqndK1vA1Z4",
    ]);
  });

  test("unfolds lines and unescapes text, trimming names and venues", async () => {
    const events = await byId(calendar);
    expect(events.get("evt-vercelNov26")?.name).toBe(
      "All Things Web at Vercel",
    );
    expect(events.get("evt-lateNight")?.name).toBe(
      "Late night, after hours; with \\backslash\\ and a\nnewline",
    );
    expect(events.get("evt-accents")).toMatchObject({
      name: "Café Ñoño — Élan & Ümlaut: ﬁne ＷＥＢ",
      location: "Café Réveille, 610 Long Bridge St, San Francisco",
    });
  });

  test("reads Luma's venue placeholder, a blank and a missing venue as none", async () => {
    const events = await byId(calendar);
    for (const id of [
      "evt-HtDmTqndK1vA1Z4",
      "evt-hiddenVenue",
      "evt-noVenue",
      "evt-blankVenue",
    ]) {
      expect(events.get(id)?.location).toBeNull();
    }
    expect(events.get("evt-online")?.location).toBe("https://zoom.us/j/123");
  });

  test("keeps cancelled, private and confidential events as drafts, in any casing", async () => {
    const events = await byId(calendar);
    const drafts = [...events.values()]
      .filter((event) => event.isDraft)
      .map((event) => event.lumaEventId);
    expect(drafts).toEqual([
      "evt-cancelled",
      "evt-private",
      "evt-confidential",
    ]);
  });

  test("keeps the highest SEQUENCE, and the later of equal ones", async () => {
    const events = await byId(calendar);
    expect(events.get("evt-resequenced")?.name).toBe("Rescheduled title");
    expect(events.get("evt-relisted")?.name).toBe("Second listing");
  });

  test.each<[string, string, string]>([
    [
      "evt-pastSentry24",
      "2024-07-31T01:00:00.000Z",
      "2024-07-31T04:00:00.000Z",
    ],
    // A named zone, in daylight time.
    ["evt-vercelNov26", "2026-11-13T01:30:00.000Z", "2026-11-13T05:00:00.000Z"],
    ["evt-newYork", "2026-11-06T00:00:00.000Z", "2026-11-06T03:00:00.000Z"],
    // Dates start at midnight in San Francisco, before and after the change.
    ["evt-allDay", "2026-03-07T08:00:00.000Z", "2026-03-09T07:00:00.000Z"],
    ["evt-oneDay", "2026-12-31T08:00:00.000Z", "2027-01-01T08:00:00.000Z"],
    // 02:30 does not exist that night: it is read with the offset before.
    ["evt-dstGap", "2026-03-08T10:30:00.000Z", "2026-03-08T11:30:00.000Z"],
    // 01:30 happens twice that night: the first one.
    ["evt-dstOverlap", "2026-11-01T08:30:00.000Z", "2026-11-01T11:00:00.000Z"],
    // Floating times are San Francisco's.
    ["evt-floating", "2026-12-11T02:00:00.000Z", "2026-12-11T05:00:00.000Z"],
    // DURATION instead of DTEND.
    ["evt-duration", "2026-11-17T02:00:00.000Z", "2026-11-17T04:30:00.000Z"],
  ])("times of %s", async (id, startDate, endDate) => {
    const found = (await byId(calendar)).get(id);
    expect(found && [iso(found.startDate), iso(found.endDate)]).toEqual([
      startDate,
      endDate,
    ]);
  });

  test("reads a repeated wall-clock time in any zone as its first occurrence (RFC 5545)", async () => {
    // The app's TZDate reads this one by the host's zone (02:30 CET on a UTC
    // host, 02:30 CEST on a European one); core reads it the same everywhere.
    const [berlin] = await parse(
      oneEvent(
        valid
          .replace(
            "DTSTART:20261016T013000Z",
            "DTSTART;TZID=Europe/Berlin:20261025T023000",
          )
          .replace(
            "DTEND:20261016T043000Z",
            "DTEND;TZID=Europe/Berlin:20261025T050000",
          ),
      ),
    );
    expect(berlin && iso(berlin.startDate)).toBe("2026-10-25T00:30:00.000Z");
  });

  test.each([
    ["an HTML page", "<html>Not a calendar</html>"],
    ["a cut-off calendar", calendar.slice(0, calendar.length / 2)],
    ["an empty calendar", "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n"],
    ["a calendar of another kind", "BEGIN:VCARD\nEND:VCARD\nEND:VCALENDAR\n"],
    [
      "an event that is not Luma's",
      oneEvent(valid.replace("@events.lu.ma", "@example.com")),
    ],
    [
      "an event without a title",
      oneEvent(valid.replace("All Things Web", "  ")),
    ],
    [
      "an event without a start",
      oneEvent(valid.replace("DTSTART:20261016T013000Z\n", "")),
    ],
    [
      "an event that ends before it starts",
      oneEvent(valid.replace("T043000Z", "T003000Z")),
    ],
    [
      "an event that ends as it starts",
      oneEvent(valid.replace("\nDTEND:20261016T043000Z", "")),
    ],
    [
      "a malformed date",
      oneEvent(valid.replace("DTEND:20261016T043000Z", "DTEND:2026-10-16")),
    ],
    [
      "an unknown time zone",
      oneEvent(
        valid
          .replace("DTSTART:", "DTSTART;TZID=Mars/Olympus_Mons:")
          .replace("T013000Z", "T013000"),
      ),
    ],
    ["a recurring event", oneEvent(`${valid}\nRRULE:FREQ=WEEKLY`)],
    [
      "an occurrence of a recurring event",
      oneEvent(`${valid}\nRECURRENCE-ID:20261016T013000Z`),
    ],
    [
      "a title that is not text",
      oneEvent(
        valid
          .replace("SUMMARY:", "SUMMARY;VALUE=INTEGER:")
          .replace("All Things Web", "7"),
      ),
    ],
  ])("rejects %s with a LumaFeedError", async (_, text) => {
    const error = await parseError(text);
    expect(error).toBeInstanceOf(LumaFeedError);
    expect(error.message).toStartWith("Luma ");
  });
});

describe("rows", () => {
  const at = (startDate: string, name: string): FeedEvent => ({
    lumaEventId: "evt-x",
    name,
    startDate: DateTime.makeUnsafe(startDate),
    endDate: DateTime.makeUnsafe(startDate),
    location: null,
    isDraft: false,
  });

  test.each([
    // The date is San Francisco's: this evening starts after midnight UTC.
    ["2026-12-02T06:30:00Z", "Late night", "2026-12-01-late-night-evt-x"],
    [
      "2026-03-08T07:59:59Z",
      "Before the change",
      "2026-03-07-before-the-change-evt-x",
    ],
    [
      "2026-07-01T07:00:00Z",
      "  Café — Ünïcode!  ",
      "2026-07-01-cafe-unicode-evt-x",
    ],
    ["2026-07-01T07:00:00Z", "🎉🎉", "2026-07-01-event-evt-x"],
    [
      "2026-07-01T07:00:00Z",
      `${"a".repeat(99)} b`,
      `2026-07-01-${"a".repeat(99)}--evt-x`,
    ],
  ])("the slug of %s %j", (startDate, name, slug) => {
    expect(eventSlug(at(startDate, name))).toBe(slug);
  });

  test("the venue name is the venue up to its first comma", () => {
    const row = toEventRow({
      ...at("2026-07-01T07:00:00Z", "x"),
      location: "Sentry, 45 Fremont St, San Francisco",
    });
    expect(row).toMatchObject({
      streetAddress: "Sentry, 45 Fremont St, San Francisco",
      shortLocation: "Sentry",
      fullAddress: "Sentry, 45 Fremont St, San Francisco",
    });
    expect(toEventRow(at("2026-07-01T07:00:00Z", "x"))).toMatchObject({
      streetAddress: null,
      shortLocation: null,
      fullAddress: null,
    });
  });
});

describe("asking Luma", () => {
  const read = (
    replies: ReadonlyArray<Reply>,
    env?: Record<string, string>,
  ) => {
    const luma = fakeLuma(replies);
    const layer = Luma.layer.pipe(
      Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
      Layer.provideMerge(clockAt(start)),
    );
    return Effect.runPromiseExit(
      settle(Luma.use((client) => client.calendarEvents)).pipe(
        Effect.provide(layer),
      ),
    ).then((exit) => ({
      exit,
      /** Seconds after the start each request was sent at. */
      times: luma.requests.map(
        (request) => (request.at - DateTime.toEpochMillis(start)) / 1000,
      ),
      requests: luma.requests,
    }));
  };
  const failure = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined;
  const error = (exit: Exit.Exit<unknown, unknown>) => {
    const reason = failure(exit);
    return reason?._tag === "Fail" ? reason.error : reason;
  };

  test("asks for the calendar's public feed, once when it answers", async () => {
    const { exit, requests } = await read([{ body: calendar }]);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([
      {
        url: "https://api.luma.com/ics/get?entity=calendar&id=cal-3AAimKnRVQEId4r",
        accept: "text/calendar",
        apiKey: undefined,
        at: DateTime.toEpochMillis(start),
      },
    ]);
  });

  test("reads the calendar LUMA_CALENDAR_API_ID names, and only a valid one", async () => {
    const other = await read([{ body: calendar }], {
      LUMA_CALENDAR_API_ID: "cal-Other1",
    });
    expect(other.requests[0]?.url).toEndWith("&id=cal-Other1");
    const invalid = await read([{ body: calendar }], {
      LUMA_CALENDAR_API_ID: "cal-x&id=cal-y",
    });
    expect(invalid.requests).toEqual([]);
    expect(error(invalid.exit)).toMatchObject({ _tag: "ConfigError" });
  });

  test("retries 5xx with exponential backoff", async () => {
    const { exit, times } = await read([
      { status: 503 },
      { status: 502 },
      { status: 500 },
      { body: calendar },
    ]);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(times).toEqual([0, 1, 3, 7]);
  });

  test("gives up after three retries", async () => {
    const { exit, times } = await read([{ status: 500 }]);
    expect(times).toEqual([0, 1, 3, 7]);
    expect(error(exit)).toEqual(
      new LumaUnavailable({ status: 500, retryAfter: null }),
    );
  });

  test("waits as long as Retry-After asks, in seconds or as a date", async () => {
    const seconds = await read([
      { status: 429, headers: { "retry-after": "7" } },
      { body: calendar },
    ]);
    expect(Exit.isSuccess(seconds.exit)).toBe(true);
    expect(seconds.times).toEqual([0, 7]);
    const date = await read([
      {
        status: 503,
        headers: { "retry-after": "Sun, 04 Oct 2026 19:00:30 GMT" },
      },
      { body: calendar },
    ]);
    expect(Exit.isSuccess(date.exit)).toBe(true);
    expect(date.times).toEqual([0, 30]);
  });

  test("fails at once when Retry-After asks for more than a minute", async () => {
    const { exit, times } = await read([
      { status: 429, headers: { "retry-after": "120" } },
    ]);
    expect(times).toEqual([0]);
    expect(error(exit)).toEqual(
      new LumaUnavailable({ status: 429, retryAfter: Duration.seconds(120) }),
    );
  });

  test("retries a dropped connection and a request without an answer in 20 seconds", async () => {
    const dropped = await read(["drop", { body: calendar }]);
    expect(Exit.isSuccess(dropped.exit)).toBe(true);
    expect(dropped.times).toEqual([0, 1]);
    const hung = await read(["hang", { body: calendar }]);
    expect(Exit.isSuccess(hung.exit)).toBe(true);
    expect(hung.times).toEqual([0, 21]);
  });

  test("does not retry a refusal or a feed that does not read", async () => {
    const refused = await read([{ status: 404 }]);
    expect(refused.times).toEqual([0]);
    expect(error(refused.exit)).toEqual(new LumaRejected({ status: 404 }));
    const html = await read([{ body: "<html></html>" }]);
    expect(html.times).toEqual([0]);
    expect(error(html.exit)).toBeInstanceOf(LumaFeedError);
  });

  test.each<[string | undefined, number | null]>([
    [undefined, null],
    ["0", 0],
    [" 12 ", 12_000],
    ["Sun, 04 Oct 2026 19:01:00 GMT", 60_000],
    ["Sun, 04 Oct 2026 18:00:00 GMT", 0],
    ["5.5", null],
    ["soon", null],
  ])("Retry-After %j", (header, millis) => {
    const delay = retryAfter(header, start);
    expect(delay === null ? null : Duration.toMillis(delay)).toBe(millis);
  });
});

describe("events a sync did not see", () => {
  // An event another sync inserted after the statement's snapshot comes back
  // without a slug, which is read again.
  const seen = {
    lumaEventId: "evt-seen",
    slug: "seen",
    isDraft: false,
    changed: true,
  };
  const unseen = {
    lumaEventId: "evt-unseen",
    slug: null,
    isDraft: true,
    changed: false,
  };

  test("take the stored slug, in feed order", () => {
    expect(
      fillUnseen(
        [unseen, seen],
        [{ lumaEventId: "evt-unseen", slug: "renamed-since" }],
      ),
    ).toEqual([
      {
        lumaEventId: "evt-unseen",
        slug: "renamed-since",
        isDraft: true,
        changed: false,
      },
      seen,
    ]);
  });

  test("keep what the statement returned for the others", () => {
    expect(
      fillUnseen([seen], [{ lumaEventId: "evt-seen", slug: "other" }]),
    ).toEqual([seen]);
  });

  test("leave the summary undefined while one is still missing", () => {
    expect(fillUnseen([seen, unseen], [])).toBeUndefined();
  });
});

describe("syncing", () => {
  const sync = (db: PGlite, at: DateTime.Utc, body: string) => {
    const luma = fakeLuma([{ body }]);
    const layer = LumaSync.layer.pipe(
      Layer.provide(
        Luma.layer.pipe(
          Layer.provide(Layer.mergeAll(luma.layer, configFrom())),
        ),
      ),
      Layer.provideMerge(sqlLayer(db)),
      Layer.provideMerge(clockAt(at)),
    );
    return Effect.runPromiseExit(
      LumaSync.use((service) => service.run).pipe(Effect.provide(layer)),
    );
  };
  const events = async (db: PGlite) =>
    (
      await db.query<Record<string, unknown>>(
        "SELECT * FROM events ORDER BY luma_event_id NULLS FIRST, slug",
      )
    ).rows;
  const withoutIds = (rows: ReadonlyArray<Record<string, unknown>>) =>
    rows.map(({ id: _, ...row }) => row);

  test("the same feed, rows and time write the same rows", async () => {
    const [a, b] = await Promise.all([migratedDatabase(), migratedDatabase()]);
    try {
      await Promise.all([a.exec(stored), b.exec(stored)]);
      const [first, second] = await Promise.all([
        sync(a, start, calendar),
        sync(b, start, calendar),
      ]);
      expect(first).toEqual(second);
      expect(withoutIds(await events(a))).toEqual(withoutIds(await events(b)));
      // Again, an hour later: nothing changed on Luma, so nothing is
      // written, updated_at included.
      const before = await events(a);
      const later = DateTime.add(start, { hours: 1 });
      const again = await sync(a, later, calendar);
      expect(Exit.isSuccess(again) && again.value).toMatchObject({
        syncedCount: 24,
        changedCount: 0,
        publishedCount: 21,
      });
      expect(await events(a)).toEqual(before);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  test("reports what it wrote", async () => {
    const db = await migratedDatabase();
    try {
      await db.exec(stored);
      const exit = await sync(db, start, calendar);
      expect(Exit.isSuccess(exit) && exit.value).toMatchObject({
        syncedCount: 24,
        // All but the secret venue night, stored as Luma shows it (its
        // venue hidden, the stored one kept): new or changed.
        changedCount: 23,
        publishedCount: 21,
      });
      // A stored event keeps its slug, and the pages to refresh say so.
      expect(Exit.isSuccess(exit) && exit.value.slugs[0]).toBe(
        "sentry-summer-2024",
      );
      const [meraki] = (
        await db.query<Record<string, unknown>>(
          "SELECT street_address, short_location, full_address FROM events WHERE luma_event_id = 'evt-HtDmTqndK1vA1Z4'",
        )
      ).rows;
      expect(meraki).toEqual({
        street_address: "500 Terry A Francois Blvd",
        short_location: "Edited venue label",
        full_address:
          "Cisco Meraki, 500 Terry A Francois Blvd, San Francisco, CA 94158",
      });
    } finally {
      await db.close();
    }
  });

  test("never writes the topic the site sets, and gives new events none", async () => {
    const db = await migratedDatabase();
    try {
      await db.exec(stored);
      const topics = async () =>
        (
          await db.query<{ slug: string; name: string; topic: string | null }>(
            "SELECT slug, name, topic FROM events WHERE topic IS NOT NULL ORDER BY slug",
          )
        ).rows;
      const before = await topics();
      expect(before.map(({ topic }) => topic)).toEqual([
        "gone",
        "sentry summer",
        "ours",
      ]);
      expect(Exit.isSuccess(await sync(db, start, calendar))).toBe(true);
      const after = await topics();
      expect(after.map(({ slug, topic }) => ({ slug, topic }))).toEqual(
        before.map(({ slug, topic }) => ({ slug, topic })),
      );
      // Luma renamed the Sentry evening, and its topic stayed.
      expect(after.find((row) => row.slug === "sentry-summer-2024")).toEqual({
        slug: "sentry-summer-2024",
        name: "All Things Web at Sentry 🚀",
        topic: "sentry summer",
      });
      const created = await db.query<{ topic: string | null }>(
        "SELECT topic FROM events WHERE created_at = $1",
        [DateTime.toDateUtc(start)],
      );
      expect(created.rows.length).toBeGreaterThan(0);
      expect(created.rows.every(({ topic }) => topic === null)).toBe(true);
    } finally {
      await db.close();
    }
  });

  test("a database failure is a DataSourceError, and writes nothing", async () => {
    const db = await migratedDatabase();
    try {
      await db.exec(
        `INSERT INTO events (slug, name, tagline, start_date, end_date, attendee_limit, updated_at)
         VALUES ('2026-10-14-venue-to-be-announced-evt-noVenue', 'Taken', 'Taken', now(), now(), 1, now())`,
      );
      const before = await events(db);
      const exit = await sync(db, start, calendar);
      expect(
        Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
          ? exit.cause.reasons[0].error
          : undefined,
      ).toBeInstanceOf(DataSourceError);
      expect(await events(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });
});
