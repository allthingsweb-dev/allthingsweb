-- What an evening is about: Luma's description and its summary (Luma-owned), and the site's own; core/migrations/0011_event_description.ts is the same change.
ALTER TABLE "events" ADD COLUMN "luma_description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "luma_summary" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "description" text;--> statement-breakpoint
-- The first Luma sync's "<name> at All Things Web" taglines become the sync's placeholder.
UPDATE "public"."events" SET "tagline" = 'See Luma for event details and registration.' WHERE "luma_event_id" = 'evt-oZuT52GZDnYkAcL' AND "tagline" = 'All Things Sync at All Things Web';--> statement-breakpoint
UPDATE "public"."events" SET "tagline" = 'See Luma for event details and registration.' WHERE "luma_event_id" = 'evt-7umBlxzGzTfOXAw' AND "tagline" = 'All Things Taste at All Things Web';--> statement-breakpoint
UPDATE "public"."events" SET "tagline" = 'See Luma for event details and registration.' WHERE "luma_event_id" = 'evt-CIXBbu7ySP61MNP' AND "tagline" = 'All Things Effect w/ Michael Arnaldi at All Things Web';--> statement-breakpoint
UPDATE "public"."events" SET "tagline" = 'See Luma for event details and registration.' WHERE "luma_event_id" = 'evt-wJxtorPCscwoGS4' AND "tagline" = 'All Things Web @ WorkOS at All Things Web';