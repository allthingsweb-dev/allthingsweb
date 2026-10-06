-- An evening's running order: each talk's position and, where known, its start; existing talks take their attach order. core/migrations/0012_talk_order.ts is the same change.
ALTER TABLE "event_talks" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "event_talks" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_talks" ADD CONSTRAINT "event_talks_position_check" CHECK ("position" >= 0);--> statement-breakpoint
UPDATE "event_talks" et SET "position" = o.n FROM (SELECT "event_id", "talk_id", (row_number() OVER (PARTITION BY "event_id" ORDER BY "created_at", "talk_id") - 1)::int AS n FROM "event_talks") o WHERE et."event_id" = o."event_id" AND et."talk_id" = o."talk_id";
