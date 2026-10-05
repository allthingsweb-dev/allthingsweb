import { statements } from "./statements.ts";

/**
 * Whose evening each event is. Ships with the app's drizzle migration
 * 0021_event_curation, which makes the same schema.
 *
 * - `ours`: an all things evening. The default: a new event from Luma is
 *   ours.
 * - `shared`: someone else's evening we share with our community because we
 *   think it's good. `organized_by` names who organizes it, a company in
 *   `sponsors`: the table that already holds companies with their logos,
 *   sites and handles, so pages link out to them and drafts tag them. A
 *   check holds the two together: a shared event has an organizer, and only
 *   a shared one does.
 *
 * Every event is ours here; the shared ones come from a sourced backfill
 * (backfill/curation.json).
 */
export const eventCuration: ReadonlyArray<string> = [
  `ALTER TABLE "public"."events" ADD COLUMN "curation" text DEFAULT 'ours' NOT NULL`,
  `ALTER TABLE "public"."events" ADD COLUMN "organized_by" uuid`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_organized_by_sponsors_id_fk" FOREIGN KEY ("organized_by") REFERENCES "public"."sponsors" ("id")`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_curation_check" CHECK ("curation" IN ('ours', 'shared'))`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_curation_organizer_check" CHECK (("curation" = 'shared') = ("organized_by" IS NOT NULL))`,
];

export default statements(eventCuration);
