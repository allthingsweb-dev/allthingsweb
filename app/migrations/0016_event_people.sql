-- Who took part in each event and how: event_people (organizers, co-hosts, MCs), each talk's format and each speaker's role, profiles' Luma user ids and events' Luma guest counts; core/migrations/0004_event_people.ts is the same change.
CREATE TABLE "event_people" (
	"event_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_people_event_id_profile_id_role_pk" PRIMARY KEY("event_id","profile_id","role"),
	CONSTRAINT "event_people_role_check" CHECK ("role" IN ('organizer', 'co-host', 'mc')),
	CONSTRAINT "event_people_position_check" CHECK ("position" >= 0),
	CONSTRAINT "event_people_source_check" CHECK ("source" IN ('luma', 'site'))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "luma_guest_count" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "luma_checked_in_count" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "luma_user_id" text;--> statement-breakpoint
ALTER TABLE "talk_speakers" ADD COLUMN "role" text DEFAULT 'speaker' NOT NULL;--> statement-breakpoint
ALTER TABLE "talks" ADD COLUMN "format" text DEFAULT 'talk' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_luma_user_id_unique" UNIQUE("luma_user_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_luma_guest_count_check" CHECK ("luma_guest_count" >= 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_luma_checked_in_count_check" CHECK ("luma_checked_in_count" >= 0);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_luma_user_id_check" CHECK ("luma_user_id" ~ '^usr-[A-Za-z0-9]+$');--> statement-breakpoint
ALTER TABLE "talk_speakers" ADD CONSTRAINT "talk_speakers_role_check" CHECK ("role" IN ('speaker', 'moderator'));--> statement-breakpoint
ALTER TABLE "talks" ADD CONSTRAINT "talks_format_check" CHECK ("format" IN ('talk', 'panel', 'fireside'));