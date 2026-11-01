/**
 * The tables the public site reads: site_reader's grants
 * (infra/scripts/site-reader.ts), and the rows whose digest is the version
 * pages are kept by (site-version.ts). A new one is added here, and
 * site-reader.ts rerun. It imports nothing, so the infra scripts read it
 * without core's dependencies.
 */
export const siteTables = [
  "events",
  "talks",
  "event_talks",
  "talk_speakers",
  "profiles",
  "sponsors",
  "event_sponsors",
  "images",
  "event_images",
  "event_people",
  "event_posts",
  "external_talks",
  "event_schedule_items",
  "event_notes",
  "profile_slugs",
  "redirects",
  "event_slugs",
] as const;
