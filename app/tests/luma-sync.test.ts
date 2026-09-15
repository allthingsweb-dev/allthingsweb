import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import { parsePublicLumaCalendar } from "../src/lib/luma/public-calendar";
import { syncPublicLumaEvents } from "../src/lib/luma/sync";
import * as schema from "../src/lib/schema";
import {
  eventsTable,
  imagesTable,
  eventImagesTable,
  talksTable,
  eventTalksTable,
  sponsorsTable,
  eventSponsorsTable,
  eventReviewSessionsTable,
} from "../src/lib/schema";

function event(
  id = "evt-test",
  extra = "",
  start = "20260916T003000Z",
  end = "20260916T033000Z",
) {
  return `BEGIN:VEVENT\r\nUID:${id}@events.lu.ma\r\nSUMMARY:All Things Web\r\nDTSTART:${start}\r\nDTEND:${end}\r\nLOCATION:Sentry\\, San Francisco\r\n${extra}END:VEVENT\r\n`;
}

function calendar(...events: string[]) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Luma//EN\r\n${events.join("")}END:VCALENDAR\r\n`;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(body: string, status = 200) {
  globalThis.fetch = Object.assign(async () => new Response(body, { status }), {
    preconnect: originalFetch.preconnect,
  });
}

describe("public Luma calendar", () => {
  test("reads past and future events, unfolded text, and escaped locations", () => {
    const rows = parsePublicLumaCalendar(
      calendar(
        event("evt-history", "", "20240731T000000Z", "20240731T030000Z"),
        event("evt-upcoming").replace(
          "SUMMARY:All Things Web",
          "SUMMARY:All Things\r\n Web",
        ),
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].startDate.toISOString()).toBe("2024-07-31T00:00:00.000Z");
    expect(rows[1].name).toBe("All ThingsWeb");
    expect(rows[1].location).toBe("Sentry, San Francisco");
    expect(rows[1].isDraft).toBe(false);
  });

  test("treats Luma's tentative events as published but withholds private/cancelled entries", () => {
    const rows = parsePublicLumaCalendar(
      calendar(
        event("evt-public", "STATUS:TENTATIVE\r\n"),
        event("evt-private", "CLASS:PRIVATE\r\n"),
        event("evt-cancelled", "STATUS:CANCELLED\r\n"),
      ),
    );
    expect(rows.map((row) => row.isDraft)).toEqual([false, true, true]);
  });

  test("deduplicates event IDs using the newest sequence", () => {
    const rows = parsePublicLumaCalendar(
      calendar(
        event("evt-test", "SEQUENCE:2\r\n").replace(
          "SUMMARY:All Things Web",
          "SUMMARY:Updated title",
        ),
        event("evt-test", "SEQUENCE:1\r\n"),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Updated title");
  });

  test("resolves named timezones and date-only events independently of the host timezone", () => {
    const timed = event()
      .replace(
        "DTSTART:20260916T003000Z",
        "DTSTART;TZID=America/Los_Angeles:20260915T173000",
      )
      .replace(
        "DTEND:20260916T033000Z",
        "DTEND;TZID=America/Los_Angeles:20260915T203000",
      );
    expect(
      parsePublicLumaCalendar(calendar(timed))[0].startDate.toISOString(),
    ).toBe("2026-09-16T00:30:00.000Z");
    const allDay = event()
      .replace("DTSTART:20260916T003000Z", "DTSTART;VALUE=DATE:20260915")
      .replace("DTEND:20260916T033000Z", "DTEND;VALUE=DATE:20260917");
    const [row] = parsePublicLumaCalendar(calendar(allDay));
    expect(row.startDate.toISOString()).toBe("2026-09-15T07:00:00.000Z");
    expect(row.endDate.toISOString()).toBe("2026-09-17T07:00:00.000Z");
  });

  test("rejects incomplete, empty, invalid and unexpanded recurring feeds", () => {
    for (const input of [
      "<html>Unavailable</html>",
      calendar(event()).replace("END:VCALENDAR", ""),
      calendar(),
      calendar(event().replace("UID:evt-test@events.lu.ma", "UID:unknown")),
      calendar(event("evt-test", "", "20260916T033000Z", "20260916T003000Z")),
      calendar(event("evt-test", "RRULE:FREQ=WEEKLY\r\n")),
    ]) {
      expect(() => parsePublicLumaCalendar(input)).toThrow();
    }
  });
});

describe("Luma synchronization against Postgres", () => {
  const client = new PGlite();
  const db = drizzle(client);

  beforeAll(async () => {
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    );
    await client.exec("CREATE SCHEMA IF NOT EXISTS neon_auth");
    for (const statement of statements) {
      await client.exec(statement);
    }
  });

  beforeEach(async () => {
    await client.exec("TRUNCATE events, images, talks, sponsors CASCADE");
  });

  afterAll(async () => {
    await client.close();
  });

  const seed = {
    name: "Original title",
    slug: "existing-url",
    startDate: new Date("2026-09-15T17:30:00Z"),
    endDate: new Date("2026-09-15T20:30:00Z"),
    tagline: "Our hand-written introduction",
    attendeeLimit: 123,
    lumaEventId: "evt-test",
    isDraft: true,
    recordingUrl: "https://example.com/recording",
    isHackathon: true,
    hackathonState: "ended" as const,
  };

  test("publishes stranded drafts and refreshes source facts without losing editorial content or relations", async () => {
    const [image] = await db
      .insert(imagesTable)
      .values({
        url: "https://example.com/photo",
        alt: "Archive photo",
        placeholder: "",
        width: 100,
        height: 100,
      })
      .returning();
    const [original] = await db
      .insert(eventsTable)
      .values({ ...seed, previewImage: image.id })
      .returning();
    const [talk] = await db
      .insert(talksTable)
      .values({ title: "Original talk", description: "Talk description" })
      .returning();
    const [sponsor] = await db
      .insert(sponsorsTable)
      .values({ name: "Original sponsor", about: "Sponsor description" })
      .returning();
    await db
      .insert(eventImagesTable)
      .values({ eventId: original.id, imageId: image.id });
    await db
      .insert(eventTalksTable)
      .values({ eventId: original.id, talkId: talk.id });
    await db
      .insert(eventSponsorsTable)
      .values({ eventId: original.id, sponsorId: sponsor.id });
    await db.insert(eventReviewSessionsTable).values({
      eventId: original.id,
      channelId: "old-channel",
      rootMessageId: "old-message",
      threadId: "old-thread",
      status: "pending",
    });
    const relatedBefore = {
      images: await db.select().from(eventImagesTable),
      talks: await db.select().from(eventTalksTable),
      sponsors: await db.select().from(eventSponsorsTable),
      reviews: await db.select().from(eventReviewSessionsTable),
    };

    respond(calendar(event()));
    const result = await syncPublicLumaEvents(db);
    expect(result.publishedCount).toBe(1);
    const [updated] = await db.select().from(eventsTable);
    expect(updated).toMatchObject({
      ...seed,
      id: original.id,
      createdAt: original.createdAt,
      previewImage: image.id,
      name: "All Things Web",
      startDate: new Date("2026-09-16T00:30:00Z"),
      endDate: new Date("2026-09-16T03:30:00Z"),
      isDraft: false,
      fullAddress: "Sentry, San Francisco",
    });
    expect({
      images: await db.select().from(eventImagesTable),
      talks: await db.select().from(eventTalksTable),
      sponsors: await db.select().from(eventSponsorsTable),
      reviews: await db.select().from(eventReviewSessionsTable),
    }).toEqual(relatedBefore);
    await syncPublicLumaEvents(db);
    expect(await db.select().from(eventsTable)).toHaveLength(1);
  });

  test("imports more than ten events including history, preserves missing and website-only records, and is repeatable", async () => {
    const originals = await db
      .insert(eventsTable)
      .values([
        {
          ...seed,
          slug: "not-in-feed",
          lumaEventId: "evt-absent",
          isDraft: false,
        },
        { ...seed, slug: "website-only", lumaEventId: null, isDraft: false },
      ])
      .returning();
    respond(
      calendar(
        ...Array.from({ length: 25 }, (_, index) =>
          event(`evt-${index}`, "", "20240731T000000Z", "20240731T030000Z"),
        ),
      ),
    );
    const result = await syncPublicLumaEvents(db);
    expect(result.syncedCount).toBe(25);
    expect(result.publishedCount).toBe(25);
    for (const original of originals) {
      expect(
        (
          await db
            .select()
            .from(eventsTable)
            .where(eq(eventsTable.id, original.id))
        )[0],
      ).toEqual(original);
    }
    expect(await db.select().from(eventsTable)).toHaveLength(27);
    await syncPublicLumaEvents(db);
    expect(await db.select().from(eventsTable)).toHaveLength(27);
    const [imported] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.lumaEventId, "evt-0"));
    expect(imported.slug).toBe("2024-07-30-all-things-web-evt-0");
    expect(imported.attendeeLimit).toBe(0);
  });

  test("failed, malformed or empty feeds leave all database records untouched", async () => {
    const originals = await db.insert(eventsTable).values(seed).returning();
    for (const [body, status] of [
      ["Unavailable", 503],
      ["<html>Not a calendar</html>", 200],
      [calendar(), 200],
      [calendar(event(), event("bad-id")), 200],
    ] as const) {
      respond(body, status);
      await expect(syncPublicLumaEvents(db)).rejects.toThrow();
      expect(await db.select().from(eventsTable)).toEqual(originals);
    }
  });

  test("a database conflict rolls back the entire snapshot", async () => {
    const originals = await db
      .insert(eventsTable)
      .values({
        ...seed,
        lumaEventId: null,
        slug: "2026-09-15-all-things-web-evt-conflict",
      })
      .returning();
    respond(calendar(event("evt-new"), event("evt-conflict")));
    await expect(syncPublicLumaEvents(db)).rejects.toThrow();
    expect(await db.select().from(eventsTable)).toEqual(originals);
  });

  test("explicit cancellation hides a previously imported event without deleting it", async () => {
    const [original] = await db
      .insert(eventsTable)
      .values({ ...seed, isDraft: false })
      .returning();
    respond(calendar(event("evt-test", "STATUS:CANCELLED\r\n")));
    await syncPublicLumaEvents(db);
    const [updated] = await db.select().from(eventsTable);
    expect(updated.id).toBe(original.id);
    expect(updated.isDraft).toBe(true);
    expect(updated.recordingUrl).toBe(original.recordingUrl);
  });
});
