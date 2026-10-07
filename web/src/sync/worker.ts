import { PgClient } from "@effect/sql-pg";
import { FollowerSource } from "allthings-core/src/followers.ts";
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
import { ShortSlugs } from "allthings-core/src/slugs.ts";
import { LumaDrafts } from "allthings-core/src/luma/drafts.ts";
import { LumaVenues } from "allthings-core/src/luma/venues.ts";
import {
  ConfigProvider,
  Effect,
  Layer,
  Redacted,
  Result,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";
import {
  type ImagesInfoBinding,
  mediaBucket,
  pictures,
  type R2BucketBinding,
  uploadWorkerBucket,
} from "./bindings.ts";
import {
  runSync,
  type SyncLimits,
  syncLimits,
  SyncLog,
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
 * Its bindings (infra/src/sync.ts), each required (see `syncBindings`):
 * - `HYPERDRIVE`: production's database as `site_sync`, from `NEON_SYNC_URL`.
 * - `MEDIA` and `MEDIA_ORIGIN`: the media bucket and where it is served.
 * - `IMAGES`: Cloudflare's Images binding.
 * - `SYNC_IMAGES`: where images are stored (`SyncImages`): "bucket" through
 *   `MEDIA`, or "upload" through the upload Worker at `MEDIA_UPLOAD_URL`,
 *   with `MEDIA_UPLOAD_TOKEN` (secret), both then required.
 * - `LUMA_API_KEY` (secret): Luma's API, for hidden venues, drafts,
 *   descriptions and covers.
 * - `X_BEARER_TOKEN` (secret): X's API, for follower counts and the post
 *   search.
 *
 * And its switches, optional:
 * - `SYNC_MODE`: "write", or "dry-run" (and anything else) to write nothing.
 * - `SYNC_PLAN`: "paid" for the app's limits, or "free" (and anything else)
 *   for runs small enough for the Workers Free plan.
 * - `LUMA_CALENDAR_API_ID`: the Luma calendar to sync; all things' own
 *   (`allThingsWebCalendarId`, core/src/luma/feed.ts) by default.
 * - `X_MAX_RESULTS`: how many posts each X search may return.
 *
 * It answers no requests: the Cron Trigger is its only way in, and whether
 * it has one is decided at deploy time (`SYNC.schedule`).
 */

export interface SyncEnv {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly MEDIA: R2BucketBinding;
  readonly MEDIA_ORIGIN: string;
  readonly IMAGES: ImagesInfoBinding;
  readonly LUMA_API_KEY: string;
  readonly X_BEARER_TOKEN: string;
  readonly SYNC_MODE?: string;
  readonly SYNC_PLAN?: string;
  readonly SYNC_IMAGES: string;
  readonly MEDIA_UPLOAD_URL?: string;
  readonly MEDIA_UPLOAD_TOKEN?: string;
}

/** The mode `env` asks for; anything unrecognized writes nothing. */
export const modeOf = (env: { readonly SYNC_MODE?: unknown }): SyncMode =>
  env.SYNC_MODE === "write" ? "write" : "dry-run";

/** The limits `env` asks for; anything unrecognized gets the Free plan's. */
export const limitsOf = (env: { readonly SYNC_PLAN?: unknown }): SyncLimits =>
  env.SYNC_PLAN === "paid" ? syncLimits.paid : syncLimits.free;

/**
 * Where a run stores images. media.allthings.dev serves the bucket of the
 * account where allthings.dev is active, and every image is recorded at its
 * URL there, so a run stores into that bucket:
 * - "bucket": through this Worker's own `MEDIA` binding, once the domain is
 *   active in this Worker's account.
 * - "upload": until then, through the upload Worker beside that bucket
 *   (infra/src/upload-worker.ts), as the app and core's scripts store.
 * infra/src/sync.ts (`syncPlan`) decides it at deploy time.
 */
export type SyncImages = "bucket" | "upload";

/** Where `env` says images go, or undefined: a run then doesn't start. */
export const imagesOf = (env: {
  readonly SYNC_IMAGES?: unknown;
}): SyncImages | undefined =>
  env.SYNC_IMAGES === "bucket" || env.SYNC_IMAGES === "upload"
    ? env.SYNC_IMAGES
    : undefined;

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Whether `value` is an object with each of `methods`. */
const isBinding = (value: unknown, ...methods: ReadonlyArray<string>) =>
  typeof value === "object" &&
  value !== null &&
  methods.every(
    (method) =>
      typeof (value as Readonly<Record<string, unknown>>)[method] ===
      "function",
  );

/**
 * What a run can't go without, each with how a missing one is named: by
 * the variable the deploy sets it from, so the log says what to set.
 */
const required: ReadonlyArray<
  readonly [
    name: string,
    present: (env: Readonly<Record<string, unknown>>) => boolean,
  ]
> = [
  [
    "HYPERDRIVE (NEON_SYNC_URL)",
    (env) =>
      isBinding(env["HYPERDRIVE"]) &&
      isText(
        (env["HYPERDRIVE"] as { readonly connectionString?: unknown })
          .connectionString,
      ),
  ],
  ["LUMA_API_KEY", (env) => isText(env["LUMA_API_KEY"])],
  ["X_BEARER_TOKEN", (env) => isText(env["X_BEARER_TOKEN"])],
  ["MEDIA", (env) => isBinding(env["MEDIA"], "put", "delete")],
  ["MEDIA_ORIGIN", (env) => isText(env["MEDIA_ORIGIN"])],
  ["IMAGES", (env) => isBinding(env["IMAGES"], "info", "input")],
  ["SYNC_IMAGES", (env) => imagesOf(env) !== undefined],
  // Only where images go through the upload Worker.
  [
    "MEDIA_UPLOAD_URL",
    (env) =>
      imagesOf(env) !== "upload" ||
      (isText(env["MEDIA_UPLOAD_URL"]) &&
        URL.parse(env["MEDIA_UPLOAD_URL"])?.protocol === "https:"),
  ],
  [
    "MEDIA_UPLOAD_TOKEN",
    (env) => imagesOf(env) !== "upload" || isText(env["MEDIA_UPLOAD_TOKEN"]),
  ],
];

/**
 * The Worker started without a binding a run needs. Nothing ran: no
 * database connection was opened and nothing was fetched. It names each
 * binding, never a value.
 */
export class SyncBindingsMissing extends Schema.TaggedError<SyncBindingsMissing>()(
  "SyncBindingsMissing",
  { missing: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `The sync Worker ran nothing: it has no ${this.missing.join(", ")}. Set ${this.missing.length === 1 ? "it" : "them"} by deploying prod with each in the environment (infra/README.md, "The Luma sync").`;
  }
}

/**
 * `env` as a run's bindings, or every one it lacks. A blank secret counts
 * as missing: a run without Luma's key would sync events but skip venues,
 * drafts, descriptions and covers, and one without X's token would read
 * follower counts from another source, each a quieter run than the one
 * reviewed. So a run has all of them, or doesn't start.
 */
export const syncBindings = (
  env: Readonly<Record<string, unknown>>,
): Result.Result<
  SyncEnv & Readonly<Record<string, unknown>>,
  SyncBindingsMissing
> => {
  const missing = required
    .filter(([, present]) => !present(env))
    .map(([name]) => name);
  return missing.length > 0
    ? Result.fail(new SyncBindingsMissing({ missing }))
    : Result.succeed(env as SyncEnv & Readonly<Record<string, unknown>>);
};

/** The bucket a run stores images into, as `SYNC_IMAGES` says. */
const bucketOf = (
  env: SyncEnv & Readonly<Record<string, unknown>>,
  fetch: typeof globalThis.fetch,
) => {
  const images = imagesOf(env);
  if (images === "bucket") return mediaBucket(env.MEDIA, env.MEDIA_ORIGIN);
  const { MEDIA_UPLOAD_URL: url, MEDIA_UPLOAD_TOKEN: token } = env;
  // syncBindings refuses both before any run: never the other bucket.
  if (images === undefined || url === undefined || token === undefined) {
    throw new Error(
      'SYNC_IMAGES is not "bucket", nor "upload" with MEDIA_UPLOAD_URL and MEDIA_UPLOAD_TOKEN',
    );
  }
  return uploadWorkerBucket(url, token, env.MEDIA_ORIGIN, fetch);
};

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
    LumaDrafts.layer,
    ShortSlugs.layer,
    LumaDescriptions.layer,
    ImageIngest.layer,
    FollowerSource.fromConfig,
    CandidateSearches.layer,
    PostSources.layer,
    // As site_sync: found posts go in only as pending.
    EventPostWriter.pendingOnly,
  ).pipe(
    Layer.provide(Layer.mergeAll(Luma.layer, LumaApi.layer, CoverSource.layer)),
    // Merged, not only provided: the follower refresh and the post search
    // read and write through the run's SqlClient and HttpClient themselves.
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
        Layer.succeed(MediaBucket, bucketOf(env, fetch)),
        Layer.succeed(Pictures, pictures(env.IMAGES)),
        ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
      ),
    ),
  );

/**
 * One scheduled run, as the Cron Trigger starts it. Without every binding
 * it needs it fails closed: it logs one line naming each missing binding
 * (`step: "preflight"`) and rejects with `SyncBindingsMissing`, before
 * opening a connection or fetching anything.
 */
export const scheduledRun = (
  env: Readonly<Record<string, unknown>>,
  /** How it reaches Luma, X and the image hosts: the runtime's fetch, or a test's. */
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<SyncReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const bindings = syncBindings(env);
      if (Result.isFailure(bindings)) {
        const log = yield* SyncLog;
        log({
          source: "luma-sync",
          step: "preflight",
          status: "failed",
          mode: modeOf(env),
          missing: bindings.failure.missing,
          reason: bindings.failure.message,
        });
        return yield* bindings.failure;
      }
      return yield* runSync(modeOf(env), limitsOf(env)).pipe(
        Effect.provide(syncLayer(bindings.success, fetch)),
        Effect.scoped,
      );
    }),
  );

export default {
  /**
   * Returns the run, rather than handing it to `waitUntil`, so a run that
   * can't start fails its invocation and the Cron Trigger's event says so.
   */
  async scheduled(
    _controller: unknown,
    env: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await scheduledRun(env);
  },
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
