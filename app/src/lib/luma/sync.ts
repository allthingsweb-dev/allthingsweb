import { TZDate } from "@date-fns/tz";
import { sql } from "drizzle-orm";
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

export async function syncPublicLumaEvents(
  database: Pick<PgDatabase<PgQueryResultHKT>, "insert">,
  calendarId?: string,
) {
  // Validate the complete feed before making a single atomic database write.
  const events = await fetchPublicLumaEvents(calendarId);
  const rows = await database
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
        streetAddress: mergeVenueField(
          "streetAddress",
          sql`excluded.street_address`,
        ),
        shortLocation: mergeVenueField(
          "shortLocation",
          sql`excluded.short_location`,
        ),
        fullAddress: mergeVenueField("fullAddress", sql`excluded.full_address`),
      },
    })
    .returning({ slug: eventsTable.slug, isDraft: eventsTable.isDraft });

  return {
    syncedCount: rows.length,
    publishedCount: rows.filter((event) => !event.isDraft).length,
    slugs: rows.map((event) => event.slug),
  };
}
