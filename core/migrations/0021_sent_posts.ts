import { statements } from "./statements.ts";

/**
 * `planning.sent_posts`: each evening's post we sent to a channel that
 * can't be read back, for the moment it was for (announce, on the day, the
 * recap), so that it goes out once (src/social/sent-posts.ts). A Discord
 * webhook can post but never list what it posted; this is the record.
 *
 * A row is claimed (`sending`) before the post is sent, with the approval
 * token of the exact text, and becomes `sent` with the message's id and
 * page when the platform takes it, or `unanswered` when no answer came.
 * One row per channel, evening and moment: a second claim is refused, so a
 * second send never starts. An unanswered claim waits for an organizer who
 * has looked at the channel to record the message found there, or to let
 * go of it.
 *
 * In the planning schema, so neither site role can read or write it
 * (tests/planning-privacy.test.ts). Ships with the app's drizzle migration
 * 0033_sent_posts, which makes the same schema.
 */
export const sentPosts: ReadonlyArray<string> = [
  `CREATE TABLE "planning"."sent_posts" (
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
  )`,
  `ALTER TABLE "planning"."sent_posts" ADD CONSTRAINT "sent_posts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action`,
];

export default statements(sentPosts);
