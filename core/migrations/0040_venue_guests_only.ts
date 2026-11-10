import { statements } from "./statements.ts";

/**
 * Whether Luma shows an evening's venue to approved guests only
 * (`events.venue_guests_only`, Luma's "location_visibility": "guests-only"),
 * as the hourly sync last read it from Luma's API
 * (src/luma/venue-visibility.ts). While it is set and the evening is not
 * over, every public surface shows only the venue's city (src/catalog.ts,
 * `publicVenue`); once the evening is over, the venue shows again. Every
 * evening starts as public; the sync's next run reads each one ahead.
 * Ships with the app's drizzle migration 0049_venue_guests_only, which
 * makes the same schema.
 *
 * site_sync, the role the hourly sync writes as, may read and write it
 * where the role exists (infra/scripts/site-sync.ts); site_reader and the
 * studio read every column of `events` already.
 */
export const venueGuestsOnly: ReadonlyArray<string> = [
  `ALTER TABLE "public"."events" ADD COLUMN "venue_guests_only" boolean DEFAULT false NOT NULL`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_sync') THEN
      GRANT SELECT ("venue_guests_only"), UPDATE ("venue_guests_only")
        ON "public"."events" TO site_sync;
    END IF;
  END
  $grant$`,
];

export default statements(venueGuestsOnly);
