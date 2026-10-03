-- Team images belong only to hacks; their bucket objects stay, and the archive/hackathon-app-2026-10-03 Neon branch keeps every dropped row.
WITH "team_images" AS (SELECT "team_image" AS "id" FROM "hacks" WHERE "team_image" IS NOT NULL), "unlinked" AS (UPDATE "hacks" SET "team_image" = NULL WHERE "team_image" IS NOT NULL) DELETE FROM "images" WHERE "id" IN (SELECT "id" FROM "team_images");--> statement-breakpoint
DROP TABLE "awards" CASCADE;--> statement-breakpoint
DROP TABLE "hack_users" CASCADE;--> statement-breakpoint
DROP TABLE "hack_votes" CASCADE;--> statement-breakpoint
DROP TABLE "hacks" CASCADE;--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "hackathon_state";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "hack_started_at";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "hack_until";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "vote_started_at";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "vote_until";--> statement-breakpoint
DROP TYPE "public"."hackathon_state";