import { statements } from "./statements.ts";

/**
 * The topic an organizer sets for an event, all things/<topic>, for names
 * that yield none (src/lockup.ts). The site owns it: the Luma sync never
 * writes it (src/luma/sync.ts).
 *
 * The CHECK is src/lockup.ts's isTopic in SQL, written out rather than
 * generated so this migration never changes after it runs;
 * tests/lockup.test.ts requires the two to agree. Character classes and
 * lower() read through the builtin "pg_c_utf8" collation, which every
 * Postgres from 17 has, so the rule is the same whatever the database's
 * locale.
 */
export const eventTopic: ReadonlyArray<string> = [
  `ALTER TABLE "public"."events" ADD COLUMN "topic" text`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_topic_check" CHECK (
    char_length("topic") <= 24
    AND "topic" IS NFC NORMALIZED
    AND "topic" = lower("topic" COLLATE "pg_c_utf8")
    AND strpos("topic", 'all things') = 0
    AND "topic" COLLATE "pg_c_utf8" ~ '^[[:alpha:][:digit:]](?:[[:alpha:][:digit:].&+#'']|(?<=[^ ]) (?=[^ ])|(?<=[[:alpha:][:digit:]])-(?=[[:alpha:][:digit:]]))*$'
  )`,
  // The published events whose names yield no topic, each found by its Luma
  // id, which the sync never changes (an organizer may edit a slug). Where
  // they do not exist (tests, a fresh database), nothing changes.

  // Dev Setup Demos - Show your agents.md!
  `UPDATE "public"."events" SET "topic" = 'dev setups' WHERE "luma_event_id" = 'evt-wJxtorPCscwoGS4'`,
  // TypeScript AI: The official conference after-party ("typescript ai
  // after-party" is 25 characters, one over the limit)
  `UPDATE "public"."events" SET "topic" = 'typescript ai afterparty' WHERE "luma_event_id" = 'evt-ITMJYP0vdkjXbMr'`,
  // After Party - All Things React Native
  `UPDATE "public"."events" SET "topic" = 'react native after-party' WHERE "luma_event_id" = 'evt-TpDFOGNSBwCxU72'`,
  // Pre Next.js Conf / Ship AI Meetup
  `UPDATE "public"."events" SET "topic" = 'ship ai' WHERE "luma_event_id" = 'evt-lPPnQypydANrkrJ'`,
  // AI x All Things Web
  `UPDATE "public"."events" SET "topic" = 'ai' WHERE "luma_event_id" = 'evt-hMrMdGcrk8XOnuF'`,
];

export default statements(eventTopic);
