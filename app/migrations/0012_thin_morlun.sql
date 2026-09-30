CREATE TABLE "event_review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" text DEFAULT 'discord' NOT NULL,
	"channel_id" text NOT NULL,
	"root_message_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"last_seen_message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_review_sessions_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "event_review_sessions_thread_id_unique" UNIQUE("thread_id")
);
--> statement-breakpoint
ALTER TABLE "event_review_sessions" ADD CONSTRAINT "event_review_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;