import { statements } from "./statements.ts";

/**
 * Each evening's short link, all things/effect at allthings.dev/effect
 * (src/short-slugs.ts). Ships with the app's drizzle migration
 * 0025_short_slugs, which makes the same schema.
 *
 * - `event_slugs`: every link an evening has been given, for good. Its key
 *   holds a link to one evening forever, so none can come to mean another;
 *   one the evening no longer uses redirects to the one it does.
 * - `events.short_slug`: the link an evening uses now, one of its own in
 *   `event_slugs` (the foreign key says so). Empty until one is given: the
 *   app's Luma sync inserts events without one, and core's link step gives
 *   them theirs (src/slugs.ts). `events.slug`, the app's long slug, stays as
 *   it is: the app still serves it, and the Worker redirects it.
 *
 * The CHECKs are src/short-slugs.ts's shortSlugPattern. Production's roles
 * get what they need where they exist: site_reader reads `event_slugs`
 * (infra/scripts/site-reader.ts), and site_sync gives links
 * (infra/scripts/site-sync.ts).
 */
export const shortSlugs: ReadonlyArray<string> = [
  `CREATE TABLE "public"."event_slugs" (
    "slug" text PRIMARY KEY NOT NULL,
    "event_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "event_slugs_event_id_slug_unique" UNIQUE ("event_id", "slug"),
    CONSTRAINT "event_slugs_slug_check" CHECK ("slug" ~ '^(shared/)?[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "event_slugs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id")
  )`,
  `ALTER TABLE "public"."events" ADD COLUMN "short_slug" text`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_short_slug_unique" UNIQUE ("short_slug")`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_id_short_slug_event_slugs_fk" FOREIGN KEY ("id", "short_slug") REFERENCES "public"."event_slugs" ("event_id", "slug")`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."event_slugs" TO site_reader;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_sync') THEN
      GRANT SELECT ("slug", "event_id"), INSERT ("slug", "event_id", "created_at")
        ON "public"."event_slugs" TO site_sync;
      GRANT SELECT ("short_slug", "topic", "curation"), UPDATE ("short_slug")
        ON "public"."events" TO site_sync;
    END IF;
  END
  $grant$`,
];

export default statements(shortSlugs);
