import { statements } from "./statements.ts";

/**
 * `community_metrics`: the community's public numbers, one snapshot a day
 * (src/community-metrics.ts): a row per day, source and metric, such as
 * `2026-11-05 discord members 517`. The day's first value stays; a later
 * read of the same day never replaces it. Nothing here identifies anyone:
 * only counts of the community's own accounts.
 *
 * The sync Worker writes it as site_sync (infra/scripts/site-sync.ts
 * grants that role the columns it inserts, and the key's columns to read,
 * nothing else), and the studio reads it (`bun run community`,
 * infra/scripts/studio.ts). The site never shows it, so site_reader has no
 * grant. Ships with the app's drizzle migration 0046_community_metrics,
 * which makes the same schema.
 */
export const communityMetrics: ReadonlyArray<string> = [
  `CREATE TABLE "public"."community_metrics" (
    "day" date NOT NULL,
    "source" text NOT NULL,
    "metric" text NOT NULL,
    "value" bigint NOT NULL,
    "read_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "community_metrics_day_source_metric_pk" PRIMARY KEY("day","source","metric"),
    CONSTRAINT "community_metrics_source_check" CHECK ("source" IN ('x', 'bluesky', 'youtube', 'discord', 'meetup', 'luma', 'npm', 'github')),
    CONSTRAINT "community_metrics_metric_check" CHECK ("metric" ~ '^[a-z][a-z_]{0,31}$'),
    CONSTRAINT "community_metrics_value_check" CHECK ("value" >= 0)
  )`,
  // site_sync gets here what its script lists (infra/scripts/site-sync.ts),
  // so the Sync Worker can take the snapshot without the script rerunning
  // and its password changing. Where the role doesn't exist (a fresh
  // database), the script grants it all when it makes it. The studio holds
  // nothing until its own script grants it (infra/scripts/studio.ts
  // --apply), as its tests require.
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_sync') THEN
      GRANT SELECT ("day", "source", "metric"), INSERT ("day", "source", "metric", "value") ON "public"."community_metrics" TO site_sync;
      GRANT SELECT ("luma_guest_count", "luma_checked_in_count") ON "public"."events" TO site_sync;
    END IF;
  END
  $grant$`,
];

export default statements(communityMetrics);
