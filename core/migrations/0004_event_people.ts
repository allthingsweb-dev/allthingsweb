import { statements } from "./statements.ts";

/**
 * Who took part in each event, and how. Ships with the app's drizzle
 * migration 0016_event_people, which makes the same schema.
 *
 * - `event_people`: a person's part in the event as a whole, apart from its
 *   talks: an all things organizer, a co-host, or the MC. `source` says who
 *   wrote the row: core's Luma people import (src/luma/people-sync.ts), which
 *   only ever changes its own rows, or the site.
 * - `talks.format` and `talk_speakers.role`: who was on stage in what
 *   capacity. A talk is a presentation, a panel or a fireside chat; each of
 *   its people either speaks (presents, or is a panel's or fireside's guest)
 *   or moderates. Every existing talk is a presentation given by speakers,
 *   which the defaults say.
 * - `profiles.luma_user_id`: the person's Luma account, the key the import
 *   matches Luma hosts by.
 * - `events.luma_guest_count` and `events.luma_checked_in_count`: guests
 *   going and guests checked in, as Luma counts them. Luma owns both.
 *
 * Production's read-only role, site_reader, may SELECT every table the
 * public site reads (infra/scripts/site-reader.ts); the site reads
 * event_people, so it gets the same grant here, where the role exists.
 */
export const eventPeople: ReadonlyArray<string> = [
  `CREATE TABLE "public"."event_people" (
    "event_id" uuid NOT NULL,
    "profile_id" uuid NOT NULL,
    "role" text NOT NULL,
    "position" integer NOT NULL,
    "source" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_people_event_id_profile_id_role_pk" PRIMARY KEY ("event_id", "profile_id", "role"),
    CONSTRAINT "event_people_role_check" CHECK ("role" IN ('organizer', 'co-host', 'mc')),
    CONSTRAINT "event_people_position_check" CHECK ("position" >= 0),
    CONSTRAINT "event_people_source_check" CHECK ("source" IN ('luma', 'site')),
    CONSTRAINT "event_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "event_people_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id")
  )`,
  `ALTER TABLE "public"."events" ADD COLUMN "luma_guest_count" integer`,
  `ALTER TABLE "public"."events" ADD COLUMN "luma_checked_in_count" integer`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_luma_guest_count_check" CHECK ("luma_guest_count" >= 0)`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_luma_checked_in_count_check" CHECK ("luma_checked_in_count" >= 0)`,
  `ALTER TABLE "public"."profiles" ADD COLUMN "luma_user_id" text`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_luma_user_id_unique" UNIQUE ("luma_user_id")`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_luma_user_id_check" CHECK ("luma_user_id" ~ '^usr-[A-Za-z0-9]+$')`,
  `ALTER TABLE "public"."talk_speakers" ADD COLUMN "role" text DEFAULT 'speaker' NOT NULL`,
  `ALTER TABLE "public"."talk_speakers" ADD CONSTRAINT "talk_speakers_role_check" CHECK ("role" IN ('speaker', 'moderator'))`,
  `ALTER TABLE "public"."talks" ADD COLUMN "format" text DEFAULT 'talk' NOT NULL`,
  `ALTER TABLE "public"."talks" ADD CONSTRAINT "talks_format_check" CHECK ("format" IN ('talk', 'panel', 'fireside'))`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."event_people" TO site_reader;
    END IF;
  END
  $grant$`,
];

export default statements(eventPeople);
