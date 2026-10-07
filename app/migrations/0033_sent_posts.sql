-- Each evening's post sent to a channel that can't be read back, claimed before it is sent so it goes out once; core/migrations/0021_sent_posts.ts is the same change.
CREATE TABLE "planning"."sent_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"event_id" uuid NOT NULL,
	"moment" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"message_id" text,
	"url" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "sent_posts_channel_event_id_moment_unique" UNIQUE("channel","event_id","moment"),
	CONSTRAINT "sent_posts_channel_check" CHECK ("channel" IN ('discord')),
	CONSTRAINT "sent_posts_moment_check" CHECK ("moment" IN ('announce', 'dayOf', 'recap')),
	CONSTRAINT "sent_posts_token_check" CHECK ("token" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "sent_posts_status_check" CHECK ("status" IN ('sending', 'unanswered', 'sent')),
	CONSTRAINT "sent_posts_sent_check" CHECK (("status" = 'sent') = ("message_id" IS NOT NULL AND "url" IS NOT NULL AND "sent_at" IS NOT NULL)),
	CONSTRAINT "sent_posts_url_check" CHECK ("url" ~ '^https://[^[:space:]]+$')
);
--> statement-breakpoint
ALTER TABLE "planning"."sent_posts" ADD CONSTRAINT "sent_posts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;