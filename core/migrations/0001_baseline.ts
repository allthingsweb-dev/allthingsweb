import { statements } from "./statements.ts";

/**
 * Neon Auth creates and owns neon_auth.users_sync wherever it is enabled,
 * production included, and the app references it. These stand in for it where
 * Neon Auth is not (tests, local Postgres) with Neon's definition, and do
 * nothing where it is.
 */
export const neonAuth: ReadonlyArray<string> = [
  `CREATE SCHEMA IF NOT EXISTS "neon_auth"`,
  `CREATE TABLE IF NOT EXISTS "neon_auth"."users_sync" (
    "raw_json" jsonb NOT NULL,
    "id" text NOT NULL GENERATED ALWAYS AS ("raw_json" ->> 'id') STORED,
    "name" text GENERATED ALWAYS AS ("raw_json" ->> 'display_name') STORED,
    "email" text GENERATED ALWAYS AS ("raw_json" ->> 'primary_email') STORED,
    "created_at" timestamp with time zone GENERATED ALWAYS AS (to_timestamp(trunc((("raw_json" ->> 'signed_up_at_millis')::bigint)::double precision) / 1000::double precision)) STORED,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "users_sync_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "users_sync_deleted_at_idx" ON "neon_auth"."users_sync" ("deleted_at")`,
  // IF NOT EXISTS keeps a table Neon Auth made, whatever its definition, so
  // check it is the one above; otherwise the baseline would be recorded over
  // a different schema.
  `DO $check$
  DECLARE
    actual text;
  BEGIN
    SELECT concat_ws(E'\\n',
      (SELECT string_agg(format('column %I %s%s%s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod),
          CASE WHEN a.attnotnull THEN ' not null' ELSE '' END,
          CASE WHEN a.attgenerated = 's' THEN ' generated always as (' || pg_catalog.pg_get_expr(d.adbin, d.adrelid) || ') stored'
            ELSE coalesce(' default ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') END), E'\\n' ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'neon_auth.users_sync'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
      (SELECT string_agg(format('constraint %I %s', c.conname, pg_catalog.pg_get_constraintdef(c.oid)), E'\\n' ORDER BY c.conname COLLATE "C")
        FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'neon_auth.users_sync'::regclass AND c.contype <> 'n'),
      (SELECT string_agg(pg_catalog.pg_get_indexdef(i.indexrelid) || CASE WHEN i.indisvalid THEN '' ELSE ' invalid' END, E'\\n' ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid) COLLATE "C")
        FROM pg_catalog.pg_index i
        WHERE i.indrelid = 'neon_auth.users_sync'::regclass))
    INTO actual;
    IF actual IS DISTINCT FROM $expected$column raw_json jsonb not null
column id text not null generated always as ((raw_json ->> 'id'::text)) stored
column name text generated always as ((raw_json ->> 'display_name'::text)) stored
column email text generated always as ((raw_json ->> 'primary_email'::text)) stored
column created_at timestamp with time zone generated always as (to_timestamp((trunc((((raw_json ->> 'signed_up_at_millis'::text))::bigint)::double precision) / (1000)::double precision))) stored
column updated_at timestamp with time zone
column deleted_at timestamp with time zone
constraint users_sync_pkey PRIMARY KEY (id)
CREATE INDEX users_sync_deleted_at_idx ON neon_auth.users_sync USING btree (deleted_at)
CREATE UNIQUE INDEX users_sync_pkey ON neon_auth.users_sync USING btree (id)$expected$ THEN
      RAISE EXCEPTION 'neon_auth.users_sync is not the table the baseline expects. It reads:%', E'\\n' || actual;
    END IF;
  END
  $check$`,
];

/**
 * Production's schema as of 2026-10-04, read from its catalog: what
 * app/migrations 0000 to 0014 left, with the changes applied to production by
 * hand that those files do not record. tests/migrations.test.ts holds it to
 * production's catalog and lists where replaying app/migrations differs.
 *
 * Production already has all of it, so it is stamped as applied rather than
 * run there (see README.md). Never edit this file: add a migration instead.
 */
export const baseline: ReadonlyArray<string> = [
  ...neonAuth,

  `CREATE TYPE "public"."profile_type" AS ENUM ('organizer', 'member')`,

  `CREATE TABLE "public"."images" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "url" text NOT NULL,
    "placeholder" text NOT NULL,
    "alt" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
  )`,
  // Production logs whole old rows for updates and deletes to these two.
  `ALTER TABLE "public"."images" REPLICA IDENTITY FULL`,
  `CREATE TABLE "public"."events" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "slug" text NOT NULL,
    "tagline" text NOT NULL,
    "attendee_limit" integer NOT NULL,
    "street_address" text,
    "short_location" text,
    "full_address" text,
    "luma_event_id" text,
    "is_hackathon" boolean DEFAULT false NOT NULL,
    "is_draft" boolean DEFAULT false NOT NULL,
    "highlight_on_landing_page" boolean DEFAULT false NOT NULL,
    "preview_image" uuid,
    "recording_url" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_slug_unique" UNIQUE ("slug"),
    CONSTRAINT "events_luma_event_id_unique" UNIQUE ("luma_event_id"),
    CONSTRAINT "events_preview_image_images_id_fk" FOREIGN KEY ("preview_image") REFERENCES "public"."images" ("id") ON DELETE SET NULL
  )`,
  `ALTER TABLE "public"."events" REPLICA IDENTITY FULL`,
  `CREATE TABLE "public"."event_images" (
    "event_id" uuid NOT NULL,
    "image_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_images_event_id_image_id_pk" PRIMARY KEY ("event_id", "image_id"),
    CONSTRAINT "event_images_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "event_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images" ("id")
  )`,
  `CREATE TABLE "public"."event_review_sessions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "provider" text DEFAULT 'discord' NOT NULL,
    "channel_id" text NOT NULL,
    "root_message_id" text NOT NULL,
    "thread_id" text NOT NULL,
    "last_seen_message_id" text,
    "status" text DEFAULT 'pending' NOT NULL,
    "approval_message_id" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_review_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_review_sessions_event_id_unique" UNIQUE ("event_id"),
    CONSTRAINT "event_review_sessions_thread_id_unique" UNIQUE ("thread_id"),
    CONSTRAINT "event_review_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id") ON DELETE CASCADE
  )`,
  // Hosting companies, under their original name.
  `CREATE TABLE "public"."sponsors" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "about" text NOT NULL,
    "square_logo_dark" uuid,
    "square_logo_light" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sponsors_name_unique" UNIQUE ("name"),
    CONSTRAINT "sponsors_square_logo_dark_images_id_fk" FOREIGN KEY ("square_logo_dark") REFERENCES "public"."images" ("id") ON DELETE SET NULL,
    CONSTRAINT "sponsors_square_logo_light_images_id_fk" FOREIGN KEY ("square_logo_light") REFERENCES "public"."images" ("id") ON DELETE SET NULL
  )`,
  `CREATE TABLE "public"."event_sponsors" (
    "event_id" uuid NOT NULL,
    "sponsor_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_sponsors_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "event_sponsors_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors" ("id")
  )`,
  `CREATE TABLE "public"."talks" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "title" text NOT NULL,
    "description" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "talks_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE "public"."event_talks" (
    "event_id" uuid NOT NULL,
    "talk_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_talks_event_id_talk_id_pk" PRIMARY KEY ("event_id", "talk_id"),
    CONSTRAINT "event_talks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "event_talks_talk_id_talks_id_fk" FOREIGN KEY ("talk_id") REFERENCES "public"."talks" ("id")
  )`,
  `CREATE TABLE "public"."profiles" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "title" text NOT NULL,
    "image" uuid,
    "twitter_handle" text,
    "bluesky_handle" text,
    "linkedin_handle" text,
    "bio" text NOT NULL,
    "profile_type" "public"."profile_type" NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "photo_source_url" text,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profiles_image_images_id_fk" FOREIGN KEY ("image") REFERENCES "public"."images" ("id") ON DELETE SET NULL
  )`,
  `CREATE TABLE "public"."talk_speakers" (
    "talk_id" uuid NOT NULL,
    "speaker_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "talk_speakers_talk_id_talks_id_fk" FOREIGN KEY ("talk_id") REFERENCES "public"."talks" ("id"),
    CONSTRAINT "talk_speakers_speaker_id_profiles_id_fk" FOREIGN KEY ("speaker_id") REFERENCES "public"."profiles" ("id")
  )`,
  `CREATE TABLE "public"."profile_users" (
    "profile_id" uuid NOT NULL,
    "user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "profile_users_profile_id_user_id_pk" PRIMARY KEY ("profile_id", "user_id"),
    CONSTRAINT "profile_users_profile_id_unique" UNIQUE ("profile_id"),
    CONSTRAINT "profile_users_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id"),
    CONSTRAINT "profile_users_user_id_users_sync_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."users_sync" ("id")
  )`,
  `CREATE TABLE "public"."administrators" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "administrators_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "administrators_user_id_users_sync_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."users_sync" ("id")
  )`,
  // Short links. Production names the primary key as drizzle names a unique
  // constraint, so this does too.
  `CREATE TABLE "public"."redirects" (
    "slug" text NOT NULL,
    "destination_url" text NOT NULL,
    "comment" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "redirects_slug_unique" PRIMARY KEY ("slug")
  )`,
];

export default statements(baseline);
