import { statements } from "./statements.ts";

/**
 * X posts in `planning.sent_posts` too (migrations/0021_sent_posts.ts), so
 * an X post goes out once by the same record as a Discord message: claimed
 * before it is sent, then sent or unanswered. `body` keeps the exact text
 * approved. X reads a post back with its links shortened to t.co, so its
 * approval token can't be worked out again from what X shows. A post found
 * on x.com after a create went unanswered is checked against this instead.
 *
 * Ships with the app's drizzle migration 0034_x_sent_posts, which makes the
 * same change.
 */
export const xSentPosts: ReadonlyArray<string> = [
  `ALTER TABLE "planning"."sent_posts" DROP CONSTRAINT "sent_posts_channel_check"`,
  `ALTER TABLE "planning"."sent_posts" ADD COLUMN "body" text`,
  `ALTER TABLE "planning"."sent_posts" ADD CONSTRAINT "sent_posts_channel_check" CHECK ("channel" IN ('discord', 'x'))`,
];

export default statements(xSentPosts);
