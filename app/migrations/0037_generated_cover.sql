-- The cover core's generator made for an evening, as bun run luma cover set it on Luma; core/migrations/0025_generated_cover.ts is the same change.
ALTER TABLE "events" ADD COLUMN "generated_cover_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "generated_cover_sha256" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "generated_cover_facts" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_generated_cover_check" CHECK (num_nonnulls("generated_cover_url", "generated_cover_sha256", "generated_cover_facts") IN (0, 3));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_generated_cover_url_check" CHECK ("generated_cover_url" ~ '^https://images\.lumacdn\.com/');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_generated_cover_sha256_check" CHECK ("generated_cover_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_generated_cover_facts_check" CHECK ("generated_cover_facts" ~ '^[0-9a-f]{16}$');