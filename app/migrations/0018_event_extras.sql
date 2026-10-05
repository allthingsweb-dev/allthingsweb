-- Each event's schedule and the notes on its page (awards, theme, teams); core/migrations/0006_event_extras.ts is the same change.
CREATE TABLE "event_notes" (
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_notes_event_id_position_pk" PRIMARY KEY("event_id","position"),
	CONSTRAINT "event_notes_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "event_schedule_items" (
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"time" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_schedule_items_event_id_position_pk" PRIMARY KEY("event_id","position"),
	CONSTRAINT "event_schedule_items_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_notes" ADD CONSTRAINT "event_notes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schedule_items" ADD CONSTRAINT "event_schedule_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;