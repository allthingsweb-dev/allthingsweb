-- An unpublished evening's organizers, co-hosts and MC, private in planning until publishing copies them; core/migrations/0024_draft_lineup.ts is the same change.
CREATE TABLE "planning"."draft_people" (
	"event_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_people_event_id_profile_id_role_pk" PRIMARY KEY("event_id","profile_id","role"),
	CONSTRAINT "draft_people_role_check" CHECK ("role" IN ('organizer', 'co-host', 'mc')),
	CONSTRAINT "draft_people_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "planning"."draft_people" ADD CONSTRAINT "draft_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."draft_people" ADD CONSTRAINT "draft_people_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;