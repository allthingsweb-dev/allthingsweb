import { statements } from "./statements.ts";

/**
 * A hosting company's own website and its X, Bluesky and LinkedIn handles,
 * stored as profiles store people's, so pages link a host's name to its
 * site and promotion drafts tag it. Ships with the app's drizzle migration
 * 0019_host_links, which makes the same schema.
 *
 * Each is optional and checked for its shape: an https URL, an X handle
 * without the @, a Bluesky domain handle, a LinkedIn company slug. The
 * values come from a sourced backfill (backfill/hosts.json), never from
 * here.
 */
export const hostLinks: ReadonlyArray<string> = [
  `ALTER TABLE "public"."sponsors" ADD COLUMN "website_url" text`,
  `ALTER TABLE "public"."sponsors" ADD COLUMN "twitter_handle" text`,
  `ALTER TABLE "public"."sponsors" ADD COLUMN "bluesky_handle" text`,
  `ALTER TABLE "public"."sponsors" ADD COLUMN "linkedin_handle" text`,
  `ALTER TABLE "public"."sponsors" ADD CONSTRAINT "sponsors_website_url_check" CHECK ("website_url" ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$')`,
  `ALTER TABLE "public"."sponsors" ADD CONSTRAINT "sponsors_twitter_handle_check" CHECK ("twitter_handle" ~ '^[A-Za-z0-9_]{1,15}$')`,
  `ALTER TABLE "public"."sponsors" ADD CONSTRAINT "sponsors_bluesky_handle_check" CHECK ("bluesky_handle" ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}$')`,
  `ALTER TABLE "public"."sponsors" ADD CONSTRAINT "sponsors_linkedin_handle_check" CHECK ("linkedin_handle" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')`,
];

export default statements(hostLinks);
