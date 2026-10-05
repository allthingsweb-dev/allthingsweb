-- Planning (ideas, wanted speakers and their availability, host prospects, contacts, notes) in its own schema that no site role may use; core/migrations/0011_planning.ts is the same change.
CREATE SCHEMA "planning";
--> statement-breakpoint
CREATE TABLE "planning"."availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wanted_speaker_id" uuid NOT NULL,
	"kind" text DEFAULT 'available' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_kind_check" CHECK ("kind" IN ('available', 'unavailable')),
	CONSTRAINT "availability_order_check" CHECK ("starts_on" <= "ends_on"),
	CONSTRAINT "availability_said_check" CHECK (num_nonnulls("starts_on", "ends_on", "note") > 0)
);
--> statement-breakpoint
CREATE TABLE "planning"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"url" text,
	"sponsor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_name_check" CHECK (btrim("name") <> ''),
	CONSTRAINT "contacts_email_check" CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
	CONSTRAINT "contacts_url_check" CHECK ("url" ~ '^https://[^[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "planning"."host_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_id" uuid,
	"company_name" text,
	"contact_id" uuid,
	"status" text DEFAULT 'prospect' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_prospects_sponsor_id_unique" UNIQUE("sponsor_id"),
	CONSTRAINT "host_prospects_company_name_unique" UNIQUE("company_name"),
	CONSTRAINT "host_prospects_company_check" CHECK (num_nonnulls("sponsor_id", "company_name") = 1),
	CONSTRAINT "host_prospects_company_name_check" CHECK (btrim("company_name") <> ''),
	CONSTRAINT "host_prospects_status_check" CHECK ("status" IN ('prospect', 'asked', 'confirmed', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "planning"."ideas" (
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
	CONSTRAINT "ideas_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "ideas_title_check" CHECK (btrim("title") <> ''),
	CONSTRAINT "ideas_pitch_check" CHECK (btrim("pitch") <> ''),
	CONSTRAINT "ideas_program_check" CHECK ("program" IN ('talks', 'open-floor', 'social', 'hackathon')),
	CONSTRAINT "ideas_topic_check" CHECK (char_length("topic") <= 24
    AND "topic" IS NFC NORMALIZED
    AND "topic" = lower("topic" COLLATE "pg_c_utf8")
    AND strpos("topic", 'all things') = 0
    AND "topic" COLLATE "pg_c_utf8" ~ '^[[:alpha:][:digit:]](?:[[:alpha:][:digit:].&+#'']|(?<=[^ ]) (?=[^ ])|(?<=[[:alpha:][:digit:]])-(?=[[:alpha:][:digit:]]))*$'),
	CONSTRAINT "ideas_status_check" CHECK ("status" IN ('idea', 'drafting', 'scheduled', 'dropped')),
	CONSTRAINT "ideas_scheduled_event_check" CHECK ("status" <> 'scheduled' OR "event_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "planning"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"sponsor_id" uuid,
	"contact_id" uuid,
	"body" text NOT NULL,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_subject_check" CHECK (num_nonnulls("profile_id", "sponsor_id", "contact_id") = 1),
	CONSTRAINT "notes_body_check" CHECK (btrim("body") <> ''),
	CONSTRAINT "notes_author_check" CHECK (btrim("author") <> '')
);
--> statement-breakpoint
CREATE TABLE "planning"."wanted_speaker_topics" (
	"wanted_speaker_id" uuid NOT NULL,
	"topic" text NOT NULL,
	CONSTRAINT "wanted_speaker_topics_wanted_speaker_id_topic_pk" PRIMARY KEY("wanted_speaker_id","topic"),
	CONSTRAINT "wanted_speaker_topics_topic_check" CHECK (char_length("topic") <= 24
    AND "topic" IS NFC NORMALIZED
    AND "topic" = lower("topic" COLLATE "pg_c_utf8")
    AND strpos("topic", 'all things') = 0
    AND "topic" COLLATE "pg_c_utf8" ~ '^[[:alpha:][:digit:]](?:[[:alpha:][:digit:].&+#'']|(?<=[^ ]) (?=[^ ])|(?<=[[:alpha:][:digit:]])-(?=[[:alpha:][:digit:]]))*$')
);
--> statement-breakpoint
CREATE TABLE "planning"."wanted_speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"contact_id" uuid,
	"status" text DEFAULT 'wanted' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wanted_speakers_profile_id_unique" UNIQUE("profile_id"),
	CONSTRAINT "wanted_speakers_contact_id_unique" UNIQUE("contact_id"),
	CONSTRAINT "wanted_speakers_person_check" CHECK (num_nonnulls("profile_id", "contact_id") = 1),
	CONSTRAINT "wanted_speakers_status_check" CHECK ("status" IN ('wanted', 'asked', 'confirmed', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "planning"."availability" ADD CONSTRAINT "availability_wanted_speaker_id_wanted_speakers_id_fk" FOREIGN KEY ("wanted_speaker_id") REFERENCES "planning"."wanted_speakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."contacts" ADD CONSTRAINT "contacts_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."host_prospects" ADD CONSTRAINT "host_prospects_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."host_prospects" ADD CONSTRAINT "host_prospects_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "planning"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."ideas" ADD CONSTRAINT "ideas_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."ideas" ADD CONSTRAINT "ideas_inspired_by_event_id_events_id_fk" FOREIGN KEY ("inspired_by_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."notes" ADD CONSTRAINT "notes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."notes" ADD CONSTRAINT "notes_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."notes" ADD CONSTRAINT "notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "planning"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."wanted_speaker_topics" ADD CONSTRAINT "wanted_speaker_topics_wanted_speaker_id_wanted_speakers_id_fk" FOREIGN KEY ("wanted_speaker_id") REFERENCES "planning"."wanted_speakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."wanted_speakers" ADD CONSTRAINT "wanted_speakers_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."wanted_speakers" ADD CONSTRAINT "wanted_speakers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "planning"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_wanted_speaker_id_idx" ON "planning"."availability" USING btree ("wanted_speaker_id");--> statement-breakpoint
CREATE INDEX "notes_profile_id_idx" ON "planning"."notes" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "notes_sponsor_id_idx" ON "planning"."notes" USING btree ("sponsor_id");--> statement-breakpoint
CREATE INDEX "notes_contact_id_idx" ON "planning"."notes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "wanted_speaker_topics_topic_idx" ON "planning"."wanted_speaker_topics" USING btree ("topic");--> statement-breakpoint
REVOKE ALL ON SCHEMA "planning" FROM PUBLIC;
