CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hack_votes" ADD COLUMN "award_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hack_votes" ADD CONSTRAINT "hack_votes_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hack_votes" DROP CONSTRAINT "hack_votes_pkey";--> statement-breakpoint
ALTER TABLE "hack_votes" ADD CONSTRAINT "hack_votes_hack_id_award_id_user_id_pk" PRIMARY KEY("hack_id","award_id","user_id");--> statement-breakpoint