import { statements } from "./statements.ts";

/**
 * Posts about an event on social platforms (X, Bluesky, LinkedIn), shown on
 * its page. Ships with the app's drizzle migration 0017_event_posts, which
 * makes the same schema.
 *
 * - `url` is the post's canonical URL (src/posts/urls.ts), unique, so
 *   adding a post twice changes nothing.
 * - `text` is plain text; the author is stored as the platform showed them.
 * - The post's first image and the author's avatar are kept as their source
 *   URLs; the hourly sync copies each into the media bucket and sets
 *   `image` and `author_avatar`. Pages never link to the source.
 * - `status`: approved posts show; hidden ones were taken down; pending ones
 *   wait for an organizer's approval, for a later candidate search to fill.
 *   Nothing ever approves itself.
 *
 * Production's read-only role, site_reader, gets SELECT here where it
 * exists (infra/scripts/site-reader.ts lists the table too).
 */
export const eventPosts: ReadonlyArray<string> = [
  `CREATE TABLE "public"."event_posts" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "platform" text NOT NULL,
    "url" text NOT NULL,
    "author_name" text NOT NULL,
    "author_handle" text,
    "author_url" text,
    "author_avatar_source_url" text,
    "author_avatar" uuid,
    "posted_at" timestamp with time zone NOT NULL,
    "text" text NOT NULL,
    "image_source_url" text,
    "image" uuid,
    "status" text DEFAULT 'approved' NOT NULL,
    "added_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_posts_url_unique" UNIQUE ("url"),
    CONSTRAINT "event_posts_platform_check" CHECK ("platform" IN ('x', 'bluesky', 'linkedin', 'other')),
    CONSTRAINT "event_posts_status_check" CHECK ("status" IN ('approved', 'hidden', 'pending')),
    CONSTRAINT "event_posts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "event_posts_author_avatar_images_id_fk" FOREIGN KEY ("author_avatar") REFERENCES "public"."images" ("id") ON DELETE SET NULL,
    CONSTRAINT "event_posts_image_images_id_fk" FOREIGN KEY ("image") REFERENCES "public"."images" ("id") ON DELETE SET NULL
  )`,
  `CREATE INDEX "event_posts_event_id_idx" ON "public"."event_posts" USING btree ("event_id")`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."event_posts" TO site_reader;
    END IF;
  END
  $grant$`,
];

export default statements(eventPosts);
