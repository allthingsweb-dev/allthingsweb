import { statements } from "./statements.ts";

/**
 * An evening's running order: each talk's `position` in it, from 0, and its
 * `starts_at` where it is known. Ships with the app's drizzle migration
 * 0024_talk_order, which makes the same schema.
 *
 * Every talk already attached takes its attach order (created_at, then the
 * talk's id), which is the order pages have shown until now. A talk
 * attached later without a position follows the positioned ones, in attach
 * order, so nothing that inserts into event_talks has to know about it.
 */
export const talkOrder: ReadonlyArray<string> = [
  `ALTER TABLE "public"."event_talks" ADD COLUMN "position" integer`,
  `ALTER TABLE "public"."event_talks" ADD COLUMN "starts_at" timestamp with time zone`,
  `ALTER TABLE "public"."event_talks" ADD CONSTRAINT "event_talks_position_check" CHECK ("position" >= 0)`,
  `UPDATE "public"."event_talks" et SET "position" = o.n
    FROM (
      SELECT "event_id", "talk_id",
        (row_number() OVER (PARTITION BY "event_id" ORDER BY "created_at", "talk_id") - 1)::int AS n
      FROM "public"."event_talks"
    ) o
    WHERE et."event_id" = o."event_id" AND et."talk_id" = o."talk_id"`,
];

export default statements(talkOrder);
