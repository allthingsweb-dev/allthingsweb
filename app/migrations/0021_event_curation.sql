-- Whose evening each event is: ours, or shared and organized by a company in sponsors; core/migrations/0009_event_curation.ts is the same change.
ALTER TABLE "events" ADD COLUMN "curation" text DEFAULT 'ours' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "organized_by" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organized_by_sponsors_id_fk" FOREIGN KEY ("organized_by") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_curation_check" CHECK ("curation" IN ('ours', 'shared'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_curation_organizer_check" CHECK (("curation" = 'shared') = ("organized_by" IS NOT NULL));