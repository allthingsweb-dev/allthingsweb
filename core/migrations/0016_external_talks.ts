import { statements } from "./statements.ts";

/**
 * Talks people gave elsewhere: at conferences, other meetups, on podcasts
 * and in videos. Ships with the app's drizzle migration 0028_external_talks,
 * which makes the same schema.
 *
 * - `kind`: conference, meetup, podcast, video or workshop.
 * - `event_name`: the conference, meetup, podcast or channel.
 * - `given_on`: the day it was given or published.
 * - `url`, `video_url`: its page and its recording, https only.
 * - `source_url`, `read_on`: where the facts were read, and on what day;
 *   the rows come from a sourced backfill (backfill/external-talks.json).
 * - One row per person, title and day.
 *
 * Production's read-only role, site_reader, gets SELECT here where it
 * exists (infra/scripts/site-reader.ts lists the table too).
 */
export const externalTalks: ReadonlyArray<string> = [
  `CREATE TABLE "public"."external_talks" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "profile_id" uuid NOT NULL,
    "title" text NOT NULL,
    "event_name" text NOT NULL,
    "kind" text NOT NULL,
    "given_on" date NOT NULL,
    "url" text,
    "video_url" text,
    "source_url" text NOT NULL,
    "read_on" date NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "external_talks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_talks_profile_id_title_given_on_unique" UNIQUE ("profile_id", "title", "given_on"),
    CONSTRAINT "external_talks_kind_check" CHECK ("kind" IN ('conference', 'meetup', 'podcast', 'video', 'workshop')),
    CONSTRAINT "external_talks_url_check" CHECK ("url" ~ '^https://'),
    CONSTRAINT "external_talks_video_url_check" CHECK ("video_url" ~ '^https://'),
    CONSTRAINT "external_talks_source_url_check" CHECK ("source_url" ~ '^https://')
  )`,
  `ALTER TABLE "public"."external_talks" ADD CONSTRAINT "external_talks_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")`,
  `CREATE INDEX "external_talks_profile_id_idx" ON "public"."external_talks" USING btree ("profile_id")`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."external_talks" TO site_reader;
    END IF;
  END
  $grant$`,
];

export default statements(externalTalks);
