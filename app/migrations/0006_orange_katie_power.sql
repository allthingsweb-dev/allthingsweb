CREATE TYPE "public"."hackathon_state" AS ENUM('before_start', 'hacking', 'voting', 'ended');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "hackathon_state" "hackathon_state";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "hack_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "hack_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "vote_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "vote_until" timestamp with time zone;