-- X posts in the sent-posts record too, with the exact text approved; core/migrations/0022_x_sent_posts.ts is the same change.
ALTER TABLE "planning"."sent_posts" DROP CONSTRAINT "sent_posts_channel_check";--> statement-breakpoint
ALTER TABLE "planning"."sent_posts" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "planning"."sent_posts" ADD CONSTRAINT "sent_posts_channel_check" CHECK ("channel" IN ('discord', 'x'));