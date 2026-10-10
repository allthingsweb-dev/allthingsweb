-- The talks of an evening that isn't published yet and who is on them, private in planning; core/migrations/0027_draft_talks.ts is the same change.
CREATE TABLE "planning"."draft_talk_people" (
	"draft_talk_id" uuid NOT NULL,
	"wanted_speaker_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_talk_people_draft_talk_id_wanted_speaker_id_pk" PRIMARY KEY("draft_talk_id","wanted_speaker_id"),
	CONSTRAINT "draft_talk_people_draft_talk_id_position_unique" UNIQUE("draft_talk_id","position"),
	CONSTRAINT "draft_talk_people_role_check" CHECK ("role" IN ('speaker', 'panelist', 'moderator')),
	CONSTRAINT "draft_talk_people_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "planning"."draft_talks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_talks_event_id_position_unique" UNIQUE("event_id","position"),
	CONSTRAINT "draft_talks_event_id_title_unique" UNIQUE("event_id","title"),
	CONSTRAINT "draft_talks_position_check" CHECK ("position" > 0),
	CONSTRAINT "draft_talks_kind_check" CHECK ("kind" IN ('talk', 'panel', 'fireside')),
	CONSTRAINT "draft_talks_title_check" CHECK (btrim("title") <> '' AND char_length("title") <= 120),
	CONSTRAINT "draft_talks_description_check" CHECK (btrim("description") <> '' AND char_length("description") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "planning"."draft_talk_people" ADD CONSTRAINT "draft_talk_people_draft_talk_id_draft_talks_id_fk" FOREIGN KEY ("draft_talk_id") REFERENCES "planning"."draft_talks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."draft_talk_people" ADD CONSTRAINT "draft_talk_people_wanted_speaker_id_wanted_speakers_id_fk" FOREIGN KEY ("wanted_speaker_id") REFERENCES "planning"."wanted_speakers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."draft_talks" ADD CONSTRAINT "draft_talks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;