import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import { SourceError } from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { compatibility } from "../../web/src/compatibility.ts";
import {
  ALLTHINGS_ACCOUNT,
  MEDIA_DOMAIN,
  Media,
  type MediaZone,
} from "./media.ts";
import { Writer } from "./reader.ts";

/**
 * The hourly Luma sync, moved off Vercel's cron to a Worker of its own
 * (web/src/sync/worker.ts). Production only. Its three switches are reviewed
 * constants, so turning it on is a one-line pull request:
 *
 * - `schedule`: "off" deploys it with no Cron Trigger at all; "hourly" runs
 *   it at the top of every hour, as the app's cron does. Hourly since the
 *   handover's first step, in dry-run beside the app's cron.
 * - `mode`: "dry-run" writes nothing and logs what it would write (the
 *   event sync rehearsed, the images it would fetch); "write" writes.
 *   Dry-run until the app's cron stops: each hour's work shows in Workers
 *   Logs, to compare with the app's, before it writes anything.
 * - `plan`: the account's Workers plan. "paid" (the allthings account is on
 *   Workers Paid) runs with the app's own limits. "free" would keep each run
 *   within the Free plan's 50 subrequests (two venues, two descriptions and
 *   two images of each kind per run, the rest in later runs), though its 10 ms of CPU per run is likely too
 *   little for the calendar and image conversions. See infra/README.md.
 */
export const SYNC = {
  schedule: "hourly",
  mode: "dry-run",
  plan: "paid",
} as const satisfies {
  schedule: "off" | "hourly";
  mode: "dry-run" | "write";
  plan: "free" | "paid";
};

/** The Cron Trigger for a schedule: none while it is off. */
export const cronsFor = (schedule: "off" | "hourly"): string[] =>
  schedule === "hourly" ? ["0 * * * *"] : [];

/**
 * The app's cron (app/vercel.json), which runs the same sync on Vercel and
 * writes production until the cutover.
 */
export const APP_SYNC_CRON = "/api/cron/luma-sync";

/**
 * Whether the Worker writes production with these switches: on a schedule,
 * in "write" mode. Production has one writer, so the Worker may write only
 * once the app's cron is gone from app/vercel.json, and the app's cron may
 * only come back once the Worker stops writing. infra/tests/sync.test.ts
 * holds the two files to that, so a pull request that would make two
 * writers fails CI.
 */
export const workerWrites = (sync: {
  readonly schedule: "off" | "hourly";
  readonly mode: "dry-run" | "write";
}): boolean => sync.schedule === "hourly" && sync.mode === "write";

/**
 * A secret from the deploy's environment, for a Worker that can't run
 * without it. Unset or blank, the deploy fails before changing anything,
 * naming the variable but never its value. (The Worker also refuses to run
 * without it: web/src/sync/worker.ts.)
 */
export const requiredSecret = (name: string) =>
  Config.Redacted(name).pipe(
    Config.mapEffect((value) =>
      Redacted.value(value).trim() === ""
        ? Effect.fail(
            new Config.ConfigError(
              new SourceError({ message: `${name} is empty` }),
            ),
          )
        : Effect.succeed(value),
    ),
  );

/**
 * Production's database as site_sync, for the sync alone. It never caches:
 * the sync reads what it is about to write, and must see the last write.
 */
export const WriterDatabase = Cloudflare.Hyperdrive.Connection("Writer", {
  origin: Writer,
  caching: { disabled: true },
  originConnectionLimit: 5,
});

/**
 * Whether the sync stores images. Each one is recorded at its URL on
 * media.allthings.dev, which serves the bucket of the account where
 * allthings.dev is active. Until the domain moves in, that is the old
 * account's bucket, which never gets what this account's Worker stores, so
 * an image stored now would be a broken link until the move. So "wait": the
 * image steps are skipped, and since they only fill in what is missing, the
 * first run after the move-day deploy (then "store") catches up.
 */
export type SyncImages = "store" | "wait";

/**
 * Whether prod runs the Sync Worker in the deploying account, and how:
 * only in the allthings account, whether allthings.dev is pending or active
 * there (a Worker with only a Cron Trigger needs no domain), storing images
 * once the zone is active. No other account ever runs it, so there is only
 * ever one Sync Worker.
 */
export const syncPlan = (
  accountId: string,
  zone: MediaZone | undefined,
): { readonly images: SyncImages } | undefined =>
  accountId !== ALLTHINGS_ACCOUNT
    ? undefined
    : { images: zone?.active === true ? "store" : "wait" };

/**
 * The Sync Worker. Its logical id stays "Sync" whatever `images` is, so
 * the move-day deploy updates the same Worker rather than replacing it.
 */
export const makeSync = (images: SyncImages) =>
  Cloudflare.Worker("Sync", {
    main: "../web/src/sync/worker.ts",
    compatibility,
    crons: cronsFor(SYNC.schedule),
    env: {
      HYPERDRIVE: WriterDatabase,
      MEDIA: Media,
      MEDIA_ORIGIN: `https://${MEDIA_DOMAIN}`,
      IMAGES: Cloudflare.Images.Images("IMAGES"),
      LUMA_API_KEY: requiredSecret("LUMA_API_KEY"),
      // X's API for follower counts (core/src/followers.ts) and the post
      // finder's search (core/src/posts/candidates.ts): the "allthings X
      // app" bearer token. X bills each post a search returns.
      X_BEARER_TOKEN: requiredSecret("X_BEARER_TOKEN"),
      SYNC_MODE: SYNC.mode,
      SYNC_PLAN: SYNC.plan,
      SYNC_IMAGES: images,
    },
  });
