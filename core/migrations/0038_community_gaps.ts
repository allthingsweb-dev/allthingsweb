import { statements } from "./statements.ts";

/**
 * `community_gaps`: the days a source of the community's numbers
 * (src/community-metrics.ts) couldn't be read for a known, temporary
 * reason, a rate limit, a refusal, a source down, or npm's counts of a
 * package too new to have them, so a gap is never a failure of the sync
 * and still shows (`bun run community`). A row per day and source: the
 * latest reason, how often it was tried, and the first and latest try.
 * Nothing here identifies anyone.
 *
 * The sync Worker writes it as site_sync (infra/scripts/site-sync.ts
 * grants that role the columns it inserts and updates, and those it reads
 * to count tries and find a source's first gap, nothing else), and the
 * studio reads it (`bun run community`, infra/scripts/studio.ts). The site
 * never shows it, so site_reader has no grant. Ships with the app's
 * drizzle migration 0047_community_gaps, which makes the same schema.
 */
export const communityGaps: ReadonlyArray<string> = [
  `CREATE TABLE "public"."community_gaps" (
    "day" date NOT NULL,
    "source" text NOT NULL,
    "reason" text NOT NULL,
    "tries" integer DEFAULT 1 NOT NULL,
    "first_at" timestamp with time zone NOT NULL,
    "last_at" timestamp with time zone NOT NULL,
    CONSTRAINT "community_gaps_day_source_pk" PRIMARY KEY("day","source"),
    CONSTRAINT "community_gaps_source_check" CHECK ("source" IN ('x', 'bluesky', 'youtube', 'discord', 'meetup', 'luma', 'npm', 'github')),
    CONSTRAINT "community_gaps_reason_check" CHECK (length("reason") BETWEEN 1 AND 200),
    CONSTRAINT "community_gaps_tries_check" CHECK ("tries" >= 1),
    CONSTRAINT "community_gaps_last_at_check" CHECK ("last_at" >= "first_at")
  )`,
  // site_sync gets here what its script lists (infra/scripts/site-sync.ts),
  // as migration 0037 granted community_metrics: the Sync Worker records
  // gaps without the script rerunning and its password changing. The
  // studio holds nothing until its own script grants it.
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_sync') THEN
      GRANT SELECT ("day", "source", "tries"), INSERT ("day", "source", "reason", "first_at", "last_at"), UPDATE ("reason", "tries", "last_at") ON "public"."community_gaps" TO site_sync;
    END IF;
  END
  $grant$`,
];

export default statements(communityGaps);
