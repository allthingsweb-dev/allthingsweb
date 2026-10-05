import * as Database from "allthings-core/src/database.ts";
import { CoverSource } from "allthings-core/src/ingest/covers.ts";
import { ImageIngest } from "allthings-core/src/ingest/ingest.ts";
import {
  MediaBucket,
  MediaBucketError,
} from "allthings-core/src/ingest/media-bucket.ts";
import { PictureError, Pictures } from "allthings-core/src/ingest/pictures.ts";
import { LumaApi } from "allthings-core/src/luma/api.ts";
import { LumaDescriptions } from "allthings-core/src/luma/descriptions.ts";
import { Luma } from "allthings-core/src/luma/luma.ts";
import { LumaSync } from "allthings-core/src/luma/sync.ts";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { runSync, syncLimits } from "../src/sync/run.ts";

/**
 * The sync Worker's dry run (src/sync/run.ts), from a maintainer's machine:
 * the same program the Cron Trigger runs in "dry-run" mode, against the
 * database at DATABASE_URL and Luma itself. It writes nothing. The event
 * sync is rehearsed in a transaction that rolls back, the description
 * import lists what it would change, and the image phases list what they
 * would fetch, so the bucket and the Images binding are never touched (here
 * they refuse). It prints a JSON line per step, as the Worker logs them.
 *
 * Run it from web/ as site_sync, the role the Worker writes as, so it also
 * proves the role's grants. LUMA_API_KEY lets it ask for descriptions and
 * list the covers it would look up. Pass both without printing them:
 *
 *   DATABASE_URL=$(op read "op://Private/allthings site_sync/credential") \
 *   LUMA_API_KEY=$(op read "op://Private/allthings Luma API key/credential") \
 *     bun scripts/sync-dry-run.ts
 */

const refuse = (what: string) => () =>
  Effect.die(new Error(`A dry run never ${what}`));

const untouched = Layer.mergeAll(
  Layer.succeed(
    MediaBucket,
    MediaBucket.of({
      put: () =>
        Effect.fail(
          new MediaBucketError({ reason: "A dry run stores nothing" }),
        ),
      remove: refuse("deletes objects"),
    }),
  ),
  Layer.succeed(
    Pictures,
    Pictures.of({
      info: () =>
        Effect.fail(
          new PictureError({ reason: "A dry run processes nothing" }),
        ),
      toJpeg: refuse("converts images"),
      placeholder: refuse("makes placeholders"),
    }),
  ),
);

const report = await Effect.runPromise(
  runSync("dry-run", syncLimits.paid).pipe(
    Effect.provide(
      Layer.mergeAll(
        LumaSync.layer,
        LumaDescriptions.layer,
        ImageIngest.layer,
      ).pipe(
        Layer.provide(
          Layer.mergeAll(Luma.layer, LumaApi.layer, CoverSource.layer),
        ),
        Layer.provide(
          Layer.mergeAll(Database.layer, FetchHttpClient.layer, untouched),
        ),
      ),
    ),
  ),
);
process.exitCode = report.ok ? 0 : 1;
