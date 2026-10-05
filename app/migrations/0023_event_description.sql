-- What an evening is about: Luma's description and its summary (Luma-owned), and the site's own; core/migrations/0011_event_description.ts is the same change.
ALTER TABLE "events" ADD COLUMN "luma_description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "luma_summary" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "description" text;