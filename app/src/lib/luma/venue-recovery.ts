import { sql, type SQL } from "drizzle-orm";
import { eventsTable } from "@/lib/schema";
import { LUMA_LOCATION_PLACEHOLDER_PATTERN } from "./public-calendar";
import archivedVenues from "./venue-archive.json";

type VenueField = "streetAddress" | "shortLocation" | "fullAddress";

// Recover only placeholder values overwritten by the first public-feed sync.
// The archive contains public venue data captured before that sync on 2026-09-16.
// A venue an organizer set (venue_by_organizer) is kept, whatever Luma shows.
export function mergeVenueField(field: VenueField, incoming: SQL): SQL {
  const archivedValue = sql`case ${eventsTable.lumaEventId} ${sql.join(
    archivedVenues.map(
      (venue) => sql`when ${venue.lumaEventId} then ${venue[field]}`,
    ),
    sql` `,
  )} else null end`;
  return sql`case when ${eventsTable.venueByOrganizer} then ${eventsTable[field]}
    else coalesce(${incoming}, case
      when ${eventsTable[field]} ~* ${LUMA_LOCATION_PLACEHOLDER_PATTERN}
        then ${archivedValue}
      else ${eventsTable[field]}
    end) end`;
}
