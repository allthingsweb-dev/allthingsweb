import { statements } from "./statements.ts";

/**
 * `planning.draft_people`: who organizes, co-hosts and MCs an evening that
 * isn't published yet. It's kept with planning, private, rather than in the
 * public lineup (`event_people`, which core/backfill/lineups.json and
 * Luma's hosts fill for published evenings), so nothing about an
 * unpublished evening goes into the repository or the public tables.
 * Readiness reads it for a draft; publishing copies it to event_people
 * (src/luma/publish.ts). Same columns and rules as event_people, but its
 * source.
 *
 * In the planning schema, so neither site role can read or write it
 * (tests/planning-privacy.test.ts). Ships with the app's drizzle migration
 * 0036_draft_lineup, which makes the same schema.
 */
export const draftLineup: ReadonlyArray<string> = [
  `CREATE TABLE "planning"."draft_people" (
    "event_id" uuid NOT NULL,
    "profile_id" uuid NOT NULL,
    "role" text NOT NULL,
    "position" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "draft_people_event_id_profile_id_role_pk" PRIMARY KEY("event_id","profile_id","role"),
    CONSTRAINT "draft_people_role_check" CHECK ("role" IN ('organizer', 'co-host', 'mc')),
    CONSTRAINT "draft_people_position_check" CHECK ("position" >= 0)
  )`,
  `ALTER TABLE "planning"."draft_people" ADD CONSTRAINT "draft_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "planning"."draft_people" ADD CONSTRAINT "draft_people_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action`,
];

export default statements(draftLineup);
