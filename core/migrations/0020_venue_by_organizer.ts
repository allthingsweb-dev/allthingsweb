import { statements } from "./statements.ts";

/**
 * An evening's venue an organizer set, which no sync changes
 * (`events.venue_by_organizer`): where Luma's venue is wrong (All Things
 * Sync was on CodeRabbit's 18th-floor rooftop, not the 12th floor Luma
 * lists), the lineups file (core/backfill/lineups.json) writes the venue and
 * sets this, and from then on the hourly syncs, core's (src/luma/sync.ts)
 * and the app's (app/src/lib/luma/sync.ts), and the venue fill
 * (src/luma/venues.ts) keep the stored one. Ships with the app's drizzle
 * migration 0032_venue_by_organizer, which makes the same schema.
 */
export const venueByOrganizer: ReadonlyArray<string> = [
  `ALTER TABLE "public"."events" ADD COLUMN "venue_by_organizer" boolean DEFAULT false NOT NULL`,
];

export default statements(venueByOrganizer);
