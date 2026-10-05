-- Every short link an event has been given, and the one it uses now; core/migrations/0011_short_slugs.ts is the same change.
CREATE TABLE "event_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_slugs_event_id_slug_unique" UNIQUE("event_id","slug"),
	CONSTRAINT "event_slugs_slug_check" CHECK ("slug" ~ '^(shared/)?[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "short_slug" text;--> statement-breakpoint
ALTER TABLE "event_slugs" ADD CONSTRAINT "event_slugs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_id_short_slug_event_slugs_fk" FOREIGN KEY ("id","short_slug") REFERENCES "public"."event_slugs"("event_id","slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_short_slug_unique" UNIQUE("short_slug");