import { statements } from "./statements.ts";

/**
 * What an evening is about, in words: its description. Ships with the app's
 * drizzle migration 0023_event_description, which makes the same schema.
 *
 * - `luma_description`: the description on Luma, as sanitized rich text,
 *   and `luma_summary`, its one line (src/luma/description.ts). Luma owns
 *   both: each import from Luma's API writes what Luma has now
 *   (src/luma/descriptions.ts).
 * - `description`: the site's own, which an organizer writes to say it
 *   differently. Nothing from Luma ever writes it. Pages show it when it
 *   says something, and Luma's otherwise.
 *
 * All three start empty; the first import fills in Luma's. site_sync, the
 * role the hourly sync writes as, may read and write Luma's two where it
 * exists (infra/scripts/site-sync.ts); site_reader reads every column of
 * `events` already.
 */
export const eventDescription: ReadonlyArray<string> = [
  `ALTER TABLE "public"."events" ADD COLUMN "luma_description" text`,
  `ALTER TABLE "public"."events" ADD COLUMN "luma_summary" text`,
  `ALTER TABLE "public"."events" ADD COLUMN "description" text`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_sync') THEN
      GRANT SELECT ("luma_description", "luma_summary"),
        UPDATE ("luma_description", "luma_summary")
        ON "public"."events" TO site_sync;
    END IF;
  END
  $grant$`,
];

export default statements(eventDescription);
