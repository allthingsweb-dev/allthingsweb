import { PgClient } from "@effect/sql-pg";
import { CoverSource } from "allthings-core/src/ingest/covers.ts";
import { CandidateSearches } from "allthings-core/src/posts/candidates.ts";
import { PostSources } from "allthings-core/src/posts/sources.ts";
import { EventPostWriter } from "allthings-core/src/posts/store.ts";
import { ImageIngest } from "allthings-core/src/ingest/ingest.ts";
import { MediaBucket } from "allthings-core/src/ingest/media-bucket.ts";
import { Pictures } from "allthings-core/src/ingest/pictures.ts";
import { LumaApi } from "allthings-core/src/luma/api.ts";
import { LumaDescriptions } from "allthings-core/src/luma/descriptions.ts";
import { Luma } from "allthings-core/src/luma/luma.ts";
import { LumaSync } from "allthings-core/src/luma/sync.ts";
import { LumaVenues } from "allthings-core/src/luma/venues.ts";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import type { ExecutionContext } from "../app.ts";
import {
  type ImagesInfoBinding,
  mediaBucket,
  pictures,
  type R2BucketBinding,
} from "./bindings.ts";
import {
  runSync,
  type SyncLimits,
  syncLimits,
  type SyncMode,
  type SyncReport,
} from "./run.ts";

/**
 * The sync Worker: the app's hourly Luma sync (run.ts) on a Cron Trigger,
 * deployed beside the site's Worker, not inside it. It holds what the site
 * must never hold: a database role that writes (`site_sync`, through its own
 * Hyperdrive, which never caches) and the media bucket. The site's bundle,
 * and its cold start, stay as they were.
 *
 * Its bindings (infra/src/sync.ts):
 * - `HYPERDRIVE`: production's database as `site_sync`.
 * - `MEDIA` and `MEDIA_ORIGIN`: the media bucket and where it is served.
 * - `IMAGES`: Cloudflare's Images binding.
 * - `LUMA_API_KEY` (secret), `LUMA_CALENDAR_API_ID` (optional).
 * - `SYNC_MODE`: "write", or "dry-run" (and anything else) to write nothing.
 * - `SYNC_PLAN`: "paid" for the app's limits, or "free" (and anything else)
 *   for runs small enough for the Workers Free plan.
 * - `X_BEARER_TOKEN` (secret, optional): the X app's token, for the post
 *   search; without it, only Bluesky is searched.
 *
 * It answers no requests: the Cron Trigger is its only way in, and whether
 * it has one is decided at deploy time (`SYNC_SCHEDULE`).
 */

export interface SyncEnv {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly MEDIA: R2BucketBinding;
  readonly MEDIA_ORIGIN: string;
  readonly IMAGES: ImagesInfoBinding;
  readonly SYNC_MODE?: string;
  readonly SYNC_PLAN?: string;
}

/** The mode `env` asks for; anything unrecognized writes nothing. */
export const modeOf = (env: Pick<SyncEnv, "SYNC_MODE">): SyncMode =>
  env.SYNC_MODE === "write" ? "write" : "dry-run";

/** The limits `env` asks for; anything unrecognized gets the Free plan's. */
export const limitsOf = (env: Pick<SyncEnv, "SYNC_PLAN">): SyncLimits =>
  env.SYNC_PLAN === "paid" ? syncLimits.paid : syncLimits.free;

/**
 * Everything a run needs, from the Worker's bindings. The database pool
 * belongs to the run and closes with it: workerd ties a socket to the
 * invocation that opened it, and Hyperdrive pools across invocations.
 */
export const syncLayer = (
  env: SyncEnv & Readonly<Record<string, unknown>>,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) =>
  Layer.mergeAll(
    LumaSync.layer,
    LumaVenues.layer,
    LumaDescriptions.layer,
    ImageIngest.layer,
    CandidateSearches.layer,
    PostSources.layer,
    EventPostWriter.layer,
  ).pipe(
    Layer.provide(Layer.mergeAll(Luma.layer, LumaApi.layer, CoverSource.layer)),
    // Merged, not only provided: the post search reads and writes through
    // the run's SqlClient and HttpClient itself.
    Layer.provideMerge(
      Layer.mergeAll(
        PgClient.layer({
          url: Redacted.make(env.HYPERDRIVE.connectionString),
          // The leg to Hyperdrive stays inside Cloudflare (see
          // ../database.ts); Hyperdrive makes the TLS connection to Neon.
          ssl: false,
        }),
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
        ),
        Layer.succeed(MediaBucket, mediaBucket(env.MEDIA, env.MEDIA_ORIGIN)),
        Layer.succeed(Pictures, pictures(env.IMAGES)),
        ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
      ),
    ),
  );

/** One scheduled run, as the Cron Trigger starts it. */
export const scheduledRun = (
  env: SyncEnv & Readonly<Record<string, unknown>>,
  /** How it reaches Luma and the image hosts: the runtime's fetch, or a test's. */
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<SyncReport> =>
  Effect.runPromise(
    runSync(modeOf(env), limitsOf(env)).pipe(
      Effect.provide(syncLayer(env, fetch)),
      Effect.scoped,
    ),
  );

export default {
  scheduled(
    _controller: unknown,
    env: SyncEnv & Readonly<Record<string, unknown>>,
    context: ExecutionContext,
  ): void {
    context.waitUntil(scheduledRun(env));
  },
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
