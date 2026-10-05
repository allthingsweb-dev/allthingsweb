-- What kind of evening each event is (talks, open floor, social, hackathon), held to agree with is_hackathon; core/migrations/0008_event_program.ts is the same change.
ALTER TABLE "events" ADD COLUMN "program" text DEFAULT 'talks' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_program_check" CHECK ("program" IN ('talks', 'open-floor', 'social', 'hackathon'));--> statement-breakpoint
UPDATE "events" SET "program" = 'hackathon' WHERE "is_hackathon";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_program_hackathon_check" CHECK (("program" = 'hackathon') = "is_hackathon");
