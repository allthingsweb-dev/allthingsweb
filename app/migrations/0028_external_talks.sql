-- Talks people gave elsewhere, sourced; core/migrations/0016_external_talks.ts is the same change.
CREATE TABLE "external_talks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	CONSTRAINT "external_talks_profile_id_title_given_on_unique" UNIQUE("profile_id","title","given_on"),
	CONSTRAINT "external_talks_kind_check" CHECK ("kind" IN ('conference', 'meetup', 'podcast', 'video', 'workshop')),
	CONSTRAINT "external_talks_url_check" CHECK ("url" ~ '^https://'),
	CONSTRAINT "external_talks_video_url_check" CHECK ("video_url" ~ '^https://'),
	CONSTRAINT "external_talks_source_url_check" CHECK ("source_url" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "external_talks" ADD CONSTRAINT "external_talks_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_talks_profile_id_idx" ON "external_talks" USING btree ("profile_id");--> statement-breakpoint
-- site_reader reads it, as core's 0016 grants (not modelled by drizzle).
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
    GRANT SELECT ON "public"."external_talks" TO site_reader;
  END IF;
END
$grant$;
