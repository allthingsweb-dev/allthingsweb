-- An idea may be postponed: put off with no date, keeping its draft; core/migrations/0039_idea_postponed.ts is the same change.
ALTER TABLE "planning"."ideas" DROP CONSTRAINT "ideas_status_check";--> statement-breakpoint
ALTER TABLE "planning"."ideas" ADD CONSTRAINT "ideas_status_check" CHECK ("status" IN ('idea', 'drafting', 'scheduled', 'postponed', 'dropped'));