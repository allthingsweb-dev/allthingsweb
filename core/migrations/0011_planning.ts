import { statements } from "./statements.ts";

/**
 * Planning: where every evening starts. Ships with the app's drizzle
 * migration 0023_planning, which makes the same schema.
 *
 * - `ideas`: an evening we might put on, with its program and topic, from a
 *   first thought (`idea`) to `drafting`, `scheduled` (it has an event) or
 *   `dropped`. `event_id` is the draft evening it became, then the event;
 *   `inspired_by_event_id` a past evening it builds on.
 * - `wanted_speakers`: someone we'd like on stage, a profile or a contact,
 *   with what they could speak about (`wanted_speaker_topics`, written as
 *   event topics are) and when they're free or not (`availability`: dates,
 *   either end open, and the words they used, "free after Dec").
 * - `host_prospects`: a company we'd like to host, one we know (`sponsors`)
 *   or a new name, with who to talk to. When it last hosted is read from
 *   its events, never stored.
 * - `contacts`: people we know who have no profile.
 * - `notes`: a note on a profile, a company or a contact.
 *
 * The rows are private; only the schema is public. They live in their own
 * Postgres schema so that no grant on `public`, not even one on ALL TABLES
 * IN SCHEMA public, can reach them: site_reader and site_sync are never
 * granted it (tests/planning-privacy.test.ts), and a new schema gives
 * PUBLIC nothing, which the last statement says outright. Nothing in this
 * repository holds planning rows: no seed, fixture or backfill, which the
 * same test enforces.
 *
 * Topics are held to src/lockup.ts's isTopic by the same CHECK as
 * events.topic (migrations/0002_event_topic.ts).
 */

const topicRule = (column: string): string => `char_length("${column}") <= 24
    AND "${column}" IS NFC NORMALIZED
    AND "${column}" = lower("${column}" COLLATE "pg_c_utf8")
    AND strpos("${column}", 'all things') = 0
    AND "${column}" COLLATE "pg_c_utf8" ~ '^[[:alpha:][:digit:]](?:[[:alpha:][:digit:].&+#'']|(?<=[^ ]) (?=[^ ])|(?<=[[:alpha:][:digit:]])-(?=[[:alpha:][:digit:]]))*$'`;

export const planning: ReadonlyArray<string> = [
  `CREATE SCHEMA "planning"`,
  `CREATE TABLE "planning"."contacts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "email" text,
    "url" text,
    "sponsor_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "contacts_name_check" CHECK (btrim("name") <> ''),
    CONSTRAINT "contacts_email_check" CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
    CONSTRAINT "contacts_url_check" CHECK ("url" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "contacts_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors" ("id")
  )`,
  `CREATE TABLE "planning"."ideas" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "title" text NOT NULL,
    "pitch" text NOT NULL,
    "program" text NOT NULL,
    "topic" text,
    "status" text DEFAULT 'idea' NOT NULL,
    "event_id" uuid,
    "inspired_by_event_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ideas_event_id_unique" UNIQUE ("event_id"),
    CONSTRAINT "ideas_title_check" CHECK (btrim("title") <> ''),
    CONSTRAINT "ideas_pitch_check" CHECK (btrim("pitch") <> ''),
    CONSTRAINT "ideas_program_check" CHECK ("program" IN ('talks', 'open-floor', 'social', 'hackathon')),
    CONSTRAINT "ideas_topic_check" CHECK (${topicRule("topic")}),
    CONSTRAINT "ideas_status_check" CHECK ("status" IN ('idea', 'drafting', 'scheduled', 'dropped')),
    CONSTRAINT "ideas_scheduled_event_check" CHECK ("status" <> 'scheduled' OR "event_id" IS NOT NULL),
    CONSTRAINT "ideas_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id") ON DELETE SET NULL,
    CONSTRAINT "ideas_inspired_by_event_id_events_id_fk" FOREIGN KEY ("inspired_by_event_id") REFERENCES "public"."events" ("id") ON DELETE SET NULL
  )`,
  `CREATE TABLE "planning"."wanted_speakers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "profile_id" uuid,
    "contact_id" uuid,
    "status" text DEFAULT 'wanted' NOT NULL,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "wanted_speakers_profile_id_unique" UNIQUE ("profile_id"),
    CONSTRAINT "wanted_speakers_contact_id_unique" UNIQUE ("contact_id"),
    CONSTRAINT "wanted_speakers_person_check" CHECK (num_nonnulls("profile_id", "contact_id") = 1),
    CONSTRAINT "wanted_speakers_status_check" CHECK ("status" IN ('wanted', 'asked', 'confirmed', 'declined')),
    CONSTRAINT "wanted_speakers_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id"),
    CONSTRAINT "wanted_speakers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "planning"."contacts" ("id")
  )`,
  `CREATE TABLE "planning"."wanted_speaker_topics" (
    "wanted_speaker_id" uuid NOT NULL,
    "topic" text NOT NULL,
    CONSTRAINT "wanted_speaker_topics_wanted_speaker_id_topic_pk" PRIMARY KEY ("wanted_speaker_id", "topic"),
    CONSTRAINT "wanted_speaker_topics_topic_check" CHECK (${topicRule("topic")}),
    CONSTRAINT "wanted_speaker_topics_wanted_speaker_id_wanted_speakers_id_fk" FOREIGN KEY ("wanted_speaker_id") REFERENCES "planning"."wanted_speakers" ("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX "wanted_speaker_topics_topic_idx" ON "planning"."wanted_speaker_topics" USING btree ("topic")`,
  `CREATE TABLE "planning"."availability" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wanted_speaker_id" uuid NOT NULL,
    "kind" text DEFAULT 'available' NOT NULL,
    "starts_on" date,
    "ends_on" date,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "availability_kind_check" CHECK ("kind" IN ('available', 'unavailable')),
    CONSTRAINT "availability_order_check" CHECK ("starts_on" <= "ends_on"),
    CONSTRAINT "availability_said_check" CHECK (num_nonnulls("starts_on", "ends_on", "note") > 0),
    CONSTRAINT "availability_wanted_speaker_id_wanted_speakers_id_fk" FOREIGN KEY ("wanted_speaker_id") REFERENCES "planning"."wanted_speakers" ("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX "availability_wanted_speaker_id_idx" ON "planning"."availability" USING btree ("wanted_speaker_id")`,
  `CREATE TABLE "planning"."host_prospects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "sponsor_id" uuid,
    "company_name" text,
    "contact_id" uuid,
    "status" text DEFAULT 'prospect' NOT NULL,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "host_prospects_sponsor_id_unique" UNIQUE ("sponsor_id"),
    CONSTRAINT "host_prospects_company_name_unique" UNIQUE ("company_name"),
    CONSTRAINT "host_prospects_company_check" CHECK (num_nonnulls("sponsor_id", "company_name") = 1),
    CONSTRAINT "host_prospects_company_name_check" CHECK (btrim("company_name") <> ''),
    CONSTRAINT "host_prospects_status_check" CHECK ("status" IN ('prospect', 'asked', 'confirmed', 'declined')),
    CONSTRAINT "host_prospects_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors" ("id"),
    CONSTRAINT "host_prospects_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "planning"."contacts" ("id")
  )`,
  `CREATE TABLE "planning"."notes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "profile_id" uuid,
    "sponsor_id" uuid,
    "contact_id" uuid,
    "body" text NOT NULL,
    "author" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "notes_subject_check" CHECK (num_nonnulls("profile_id", "sponsor_id", "contact_id") = 1),
    CONSTRAINT "notes_body_check" CHECK (btrim("body") <> ''),
    CONSTRAINT "notes_author_check" CHECK (btrim("author") <> ''),
    CONSTRAINT "notes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id"),
    CONSTRAINT "notes_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors" ("id"),
    CONSTRAINT "notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "planning"."contacts" ("id")
  )`,
  `CREATE INDEX "notes_profile_id_idx" ON "planning"."notes" USING btree ("profile_id")`,
  `CREATE INDEX "notes_sponsor_id_idx" ON "planning"."notes" USING btree ("sponsor_id")`,
  `CREATE INDEX "notes_contact_id_idx" ON "planning"."notes" USING btree ("contact_id")`,
  `REVOKE ALL ON SCHEMA "planning" FROM PUBLIC`,
];

export default statements(planning);
