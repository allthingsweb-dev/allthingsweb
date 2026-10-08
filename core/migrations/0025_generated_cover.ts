import { statements } from "./statements.ts";

/**
 * The cover our generator made for an evening, as `bun run luma cover`
 * set it on Luma (src/luma/cover.ts): every evening's cover is
 * allthings-branded and its own, never Luma's default, so what was set is
 * recorded for the readiness checks to compare against.
 *
 * - `generated_cover_url`: the cover's address on Luma's CDN, as Luma
 *   reads it back after the update.
 * - `generated_cover_sha256`: the SHA-256 of the PNG that was uploaded.
 * - `generated_cover_facts`: the approval token (src/approval.ts) of the
 *   facts the cover says (topic, date, neighborhood, hosts, link), so an
 *   evening whose facts changed since is seen to need a new one.
 *
 * All three or none. Only the owner writes them: site_sync is granted
 * columns by name (infra/scripts/site-sync.ts) and is given none of these.
 * Ships with the app's drizzle migration 0037_generated_cover, which makes
 * the same change.
 */
export const generatedCover: ReadonlyArray<string> = [
  `ALTER TABLE "public"."events" ADD COLUMN "generated_cover_url" text`,
  `ALTER TABLE "public"."events" ADD COLUMN "generated_cover_sha256" text`,
  `ALTER TABLE "public"."events" ADD COLUMN "generated_cover_facts" text`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_generated_cover_check" CHECK (num_nonnulls("generated_cover_url", "generated_cover_sha256", "generated_cover_facts") IN (0, 3))`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_generated_cover_url_check" CHECK ("generated_cover_url" ~ '^https://images\\.lumacdn\\.com/')`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_generated_cover_sha256_check" CHECK ("generated_cover_sha256" ~ '^[0-9a-f]{64}$')`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_generated_cover_facts_check" CHECK ("generated_cover_facts" ~ '^[0-9a-f]{16}$')`,
];

export default statements(generatedCover);
