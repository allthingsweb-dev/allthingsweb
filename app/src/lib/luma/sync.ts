import { TZDate } from "@date-fns/tz";
import { eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { eventsTable } from "@/lib/schema";
import { fetchPublicLumaEvents, type PublicLumaEvent } from "./public-calendar";
import { mergeVenueField } from "./venue-recovery";

function eventSlug(event: PublicLumaEvent): string {
  const date = new TZDate(event.startDate, "America/Los_Angeles");
  const datePrefix = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const name = event.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return `${datePrefix}-${name || "event"}-${event.lumaEventId}`;
}

/**
 * Writes the public Luma calendar to `events` in one statement, all or
 * nothing. A stored event is written only when one of the columns Luma owns
 * would change (venue fields as merged by mergeVenueField), so its updated_at
 * says when Luma last changed it: a sync of an unchanged calendar writes
 * nothing. core/src/luma/sync.ts is the same sync, row for row.
 */
export async function syncPublicLumaEvents(
  database: Pick<PgDatabase<PgQueryResultHKT>, "$with" | "with" | "insert">,
  calendarId?: string,
) {
  // Validate the complete feed before making a single atomic database write.
  const events = await fetchPublicLumaEvents(calendarId);
  const venue = {
    streetAddress: mergeVenueField(
      "streetAddress",
      sql`excluded.street_address`,
    ),
    shortLocation: mergeVenueField(
      "shortLocation",
      sql`excluded.short_location`,
    ),
    fullAddress: mergeVenueField("fullAddress", sql`excluded.full_address`),
  };
  // Returns only the rows it writes, with updated_at bumped by the schema.
  const written = database.$with("written").as(
    database
      .insert(eventsTable)
      .values(
        events.map((event) => ({
          name: event.name,
          startDate: event.startDate,
          endDate: event.endDate,
          lumaEventId: event.lumaEventId,
          isDraft: event.isDraft,
          slug: eventSlug(event),
          tagline: "See Luma for event details and registration.",
          attendeeLimit: 0,
          streetAddress: event.location,
          shortLocation: event.location?.split(",")[0] ?? null,
          fullAddress: event.location,
        })),
      )
      .onConflictDoUpdate({
        target: eventsTable.lumaEventId,
        // Keep the event ID, slug, editorial content and all related records.
        set: {
          name: sql`excluded.name`,
          startDate: sql`excluded.start_date`,
          endDate: sql`excluded.end_date`,
          isDraft: sql`excluded.is_draft`,
          ...venue,
        },
        // Leave an event that is already up to date alone, updated_at included.
        setWhere: sql`(${eventsTable.name}, ${eventsTable.startDate},
          ${eventsTable.endDate}, ${eventsTable.isDraft},
          ${eventsTable.streetAddress}, ${eventsTable.shortLocation},
          ${eventsTable.fullAddress})
          is distinct from (excluded.name, excluded.start_date,
          excluded.end_date, excluded.is_draft, ${venue.streetAddress},
          ${venue.shortLocation}, ${venue.fullAddress})`,
      })
      .returning({
        lumaEventId: eventsTable.lumaEventId,
        slug: eventsTable.slug,
        isDraft: eventsTable.isDraft,
      }),
  );
  // An event left alone is read as the statement found it, which is as it
  // stays; every feed event is either written or stored.
  const rows = await database
    .with(written)
    .select({
      lumaEventId: sql<string>`coalesce(${written.lumaEventId}, ${eventsTable.lumaEventId})`,
      slug: sql<string>`coalesce(${written.slug}, ${eventsTable.slug})`,
      isDraft: sql<boolean>`coalesce(${written.isDraft}, ${eventsTable.isDraft})`,
      changed: sql<boolean>`${written.lumaEventId} is not null`,
    })
    .from(written)
    .fullJoin(eventsTable, eq(written.lumaEventId, eventsTable.lumaEventId))
    .where(
      or(
        isNotNull(written.lumaEventId),
        inArray(
          eventsTable.lumaEventId,
          events.map((event) => event.lumaEventId),
        ),
      ),
    );
  const byLumaId = new Map(rows.map((row) => [row.lumaEventId, row]));
  // In feed order, as the pages to refresh have always been listed.
  const synced = events.map((event) => {
    const row = byLumaId.get(event.lumaEventId);
    if (!row) {
      throw new Error(
        `Luma event ${event.lumaEventId} was neither written nor stored`,
      );
    }
    return row;
  });

  return {
    syncedCount: synced.length,
    changedCount: synced.filter((event) => event.changed).length,
    publishedCount: synced.filter((event) => !event.isDraft).length,
    slugs: synced.map((event) => event.slug),
  };
}
