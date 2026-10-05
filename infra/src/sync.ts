import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import { compatibility } from "../../web/src/compatibility.ts";
import { MEDIA_DOMAIN, Media } from "./media.ts";
import { Writer } from "./reader.ts";

/**
 * The hourly Luma sync, moved off Vercel's cron to a Worker of its own
 * (web/src/sync/worker.ts). Production only. Its three switches are reviewed
 * constants, so turning it on is a one-line pull request:
 *
 * - `schedule`: "off" deploys it with no Cron Trigger at all; "hourly" runs
 *   it at the top of every hour, as the app's cron does. Off until the
 *   cutover, when the app's cron stops.
 * - `mode`: "dry-run" writes nothing and logs what it would write (the
 *   event sync rehearsed, the images it would fetch); "write" writes.
 *   Turning the schedule on in dry-run first shows an hour's work in Workers
 *   Logs before it writes anything.
 * - `plan`: the account's Workers plan. "paid" (the allthings account is on
 *   Workers Paid) runs with the app's own limits. "free" would keep each run
 *   within the Free plan's 50 subrequests (two images of each kind per run,
 *   the rest in later runs), though its 10 ms of CPU per run is likely too
 *   little for the calendar and image conversions. See infra/README.md.
 */
export const SYNC = {
  schedule: "off",
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
 * Production's database as site_sync, for the sync alone. It never caches:
 * the sync reads what it is about to write, and must see the last write.
 */
export const WriterDatabase = Cloudflare.Hyperdrive.Connection("Writer", {
  origin: Writer,
  caching: { disabled: true },
  originConnectionLimit: 5,
});

export const Sync = Cloudflare.Worker("Sync", {
  main: "../web/src/sync/worker.ts",
  compatibility,
  crons: cronsFor(SYNC.schedule),
  env: {
    HYPERDRIVE: WriterDatabase,
    MEDIA: Media,
    MEDIA_ORIGIN: `https://${MEDIA_DOMAIN}`,
    IMAGES: Cloudflare.Images.Images("IMAGES"),
    LUMA_API_KEY: Config.Redacted("LUMA_API_KEY"),
    SYNC_MODE: SYNC.mode,
    SYNC_PLAN: SYNC.plan,
  },
});
