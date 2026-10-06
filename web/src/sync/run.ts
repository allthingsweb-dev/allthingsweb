import {
  type FollowerSource,
  refreshFollowers,
} from "allthings-core/src/followers.ts";
import type { SqlClient } from "effect/sql/SqlClient";
import { ImageIngest } from "allthings-core/src/ingest/ingest.ts";
import { LumaSync } from "allthings-core/src/luma/sync.ts";
import { LumaVenues } from "allthings-core/src/luma/venues.ts";
import { Clock, Context, Duration, Effect, Exit } from "effect";

/**
 * One run of the hourly sync, as the app's cron runs it
 * (app/src/app/api/cron/luma-sync/route.ts): events from Luma's calendar
 * first, then the venues the calendar hides, from Luma's API (which the
 * app's cron does not ask), then the images still missing (profile photos,
 * post images, event covers), each image phase in its own time window.
 * Every step writes only what is missing or changed, so a run repeated, or
 * one cut short, leaves the database as consistent as before and the next
 * run carries on.
 *
 * - `write` writes, as the app's cron does.
 * - `dry-run` writes nothing: the event sync is rehearsed (its statement in
 *   a transaction that rolls back), the venue fill lists the venues it
 *   would write, and the image phases list what they would fetch, without
 *   fetching it.
 *
 * Each step logs one JSON line, and the run one summary line, for Workers
 * Logs to index.
 */

export type SyncMode = "write" | "dry-run";

/**
 * How much one run may do. The app's windows suit the Workers Paid plan
 * (a cron run there gets up to 15 minutes and 10,000 subrequests). On the
 * Free plan a run gets 10 ms of CPU and 50 subrequests to the internet, so
 * each image phase tries a few images at most and the rest wait for later
 * runs (see infra/README.md).
 */
export interface SyncLimits {
  /** No image phase starts after this long. */
  readonly startBefore: Duration.Input;
  /** The covers phase, last, is cut off after this long. */
  readonly cancelAfter: Duration.Input;
  readonly photos: {
    readonly window: Duration.Input;
    readonly maxItems?: number;
  };
  readonly posts: {
    readonly window: Duration.Input;
    readonly maxItems?: number;
  };
  readonly covers: { readonly maxItems?: number };
  /** Events without a venue asked about; every one by default. */
  readonly venues: { readonly maxEvents?: number };
  /**
   * X follower counts read (core/src/followers.ts), the missing and oldest
   * first; a count newer than `staleAfter` is left alone.
   */
  readonly followers: {
    readonly maxProfiles: number;
    readonly staleAfter: Duration.Input;
  };
}

export const syncLimits = {
  /** The app's: 10 s for photos, 20 s for posts (at most 40), covers until 35 s, cut at 50 s. */
  paid: {
    startBefore: "35 seconds",
    cancelAfter: "50 seconds",
    photos: { window: "10 seconds" },
    posts: { window: "20 seconds", maxItems: 40 },
    covers: {},
    venues: {},
    followers: { maxProfiles: 40, staleAfter: "7 days" },
  },
  /**
   * Within 50 subrequests: the feed is one, each venue one, and each image
   * at most six (a cover lookup and its fallback, a download and three
   * redirects), so two venues and two images of each kind are at most 39.
   */
  free: {
    startBefore: "35 seconds",
    cancelAfter: "50 seconds",
    photos: { window: "10 seconds", maxItems: 2 },
    posts: { window: "20 seconds", maxItems: 2 },
    covers: { maxItems: 2 },
    venues: { maxEvents: 2 },
    followers: { maxProfiles: 2, staleAfter: "7 days" },
  },
} as const satisfies Record<string, SyncLimits>;

export type SyncPlan = keyof typeof syncLimits;

/** Where the run's log lines go: one JSON object each. */
export class SyncLog extends Context.Reference<
  (entry: Readonly<Record<string, unknown>>) => void
>("allthings/web/SyncLog", {
  defaultValue: () => (entry) => console.log(JSON.stringify(entry)),
}) {}

const log = (entry: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const write = yield* SyncLog;
    write({ source: "luma-sync", ...entry });
  });

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** What each step reported, or why it didn't run. */
export type StepReport =
  | { readonly status: "done"; readonly [field: string]: unknown }
  | { readonly status: "skipped" | "failed"; readonly reason: string };

export interface SyncReport {
  readonly mode: SyncMode;
  readonly ok: boolean;
  readonly tookMs: number;
  readonly steps: Readonly<Record<string, StepReport>>;
}

/** Runs one step, logs it, and reports it; a failed step never throws. */
const step = <A extends Record<string, unknown>, E>(
  name: string,
  effect: Effect.Effect<A, E>,
): Effect.Effect<StepReport> =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const exit = yield* Effect.exit(effect);
    const tookMs = (yield* Clock.currentTimeMillis) - started;
    const report: StepReport = Exit.isSuccess(exit)
      ? { status: "done", ...exit.value }
      : {
          status: "failed",
          reason: messageOf(
            exit.cause.reasons.find((reason) => reason._tag === "Fail")
              ?.error ??
              exit.cause.reasons.find((reason) => reason._tag === "Die")
                ?.defect ??
              "interrupted",
          ),
        };
    yield* log({ step: name, tookMs, ...report });
    return report;
  });

const skipped = (name: string, reason: string) =>
  Effect.as(log({ step: name, status: "skipped", reason }), {
    status: "skipped",
    reason,
  } as const);

/**
 * The venue fill (core's src/luma/venues.ts) within `limits`, as a step
 * reports it: each venue it wrote, and the events Luma has none for.
 */
const venues = (
  filler: LumaVenues["Service"],
  limits: SyncLimits,
  dryRun: boolean,
) =>
  Effect.gen(function* () {
    const { maxEvents } = limits.venues;
    const result = yield* filler.run({
      dryRun,
      ...(maxEvents === undefined ? {} : { maxEvents }),
    });
    if (result._tag === "Skipped") return { skipped: result.reason };
    return {
      asked: result.asked,
      written: result.written,
      filled: result.filled.map(({ slug, venue }) => ({
        slug,
        fullAddress: venue.fullAddress,
      })),
      unplaced: result.unplaced,
      unavailable: result.unavailable,
    };
  });

/** A run that writes, as the app's cron does, and fills in hidden venues. */
const write = (limits: SyncLimits) =>
  Effect.gen(function* () {
    const sync = yield* LumaSync;
    const ingest = yield* ImageIngest;
    const started = yield* Clock.currentTimeMillis;
    const startBy = started + Duration.toMillis(limits.startBefore);
    /** What is left of `window` before no phase may start, or None. */
    const windowLeft = (window: Duration.Input) =>
      Effect.map(Clock.currentTimeMillis, (now) =>
        Math.min(Duration.toMillis(window), startBy - now),
      );

    const steps: Record<string, StepReport> = {};
    steps["events"] = yield* step(
      "events",
      Effect.map(sync.run, ({ syncedCount, changedCount, publishedCount }) => ({
        syncedCount,
        changedCount,
        publishedCount,
      })),
    );
    // The app stops when the events fail: venues and images then wait
    // for a run that reads the calendar.
    if (steps["events"].status !== "done") return steps;

    steps["venues"] = yield* step(
      "venues",
      venues(yield* LumaVenues, limits, false),
    );

    const photosLeft = yield* windowLeft(limits.photos.window);
    steps["photos"] =
      photosLeft <= 0
        ? yield* skipped("photos", "no time left")
        : yield* step(
            "photos",
            ingest
              .profilePhotos({
                budget: photosLeft,
                ...(limits.photos.maxItems === undefined
                  ? {}
                  : { maxItems: limits.photos.maxItems }),
              })
              .pipe(Effect.map((result) => ({ ...result }))),
          );

    const postsLeft = yield* windowLeft(limits.posts.window);
    steps["posts"] =
      postsLeft <= 0
        ? yield* skipped("posts", "no time left")
        : yield* step(
            "posts",
            ingest
              .postImages({
                budget: postsLeft,
                ...(limits.posts.maxItems === undefined
                  ? {}
                  : { maxItems: limits.posts.maxItems }),
              })
              .pipe(Effect.map((result) => ({ ...result }))),
          );

    const now = yield* Clock.currentTimeMillis;
    const coversLeft = startBy - now;
    const cancelLeft = started + Duration.toMillis(limits.cancelAfter) - now;
    steps["covers"] =
      coversLeft <= 0
        ? yield* skipped("covers", "no time left")
        : yield* step(
            "covers",
            ingest
              .covers({
                budget: coversLeft,
                ...(limits.covers.maxItems === undefined
                  ? {}
                  : { maxItems: limits.covers.maxItems }),
              })
              .pipe(
                Effect.map((result) => ({ ...result })),
                Effect.timeout(Math.max(0, cancelLeft)),
              ),
          );

    steps["followers"] = yield* step(
      "followers",
      yield* followers(limits, false),
    );
    return steps;
  });

/**
 * Refreshing X follower counts within `limits`, as a step reports it, with
 * the services the run already has.
 */
const followers = (limits: SyncLimits, dryRun: boolean) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<FollowerSource | SqlClient>();
    return refreshFollowers({
      dryRun,
      maxProfiles: limits.followers.maxProfiles,
      staleAfter: limits.followers.staleAfter,
    }).pipe(
      Effect.map((report) => ({ ...report })),
      Effect.provideContext(context),
    );
  });

/** A run that writes nothing and reports what `write` would do now. */
const dryRun = (limits: SyncLimits) =>
  Effect.gen(function* () {
    const sync = yield* LumaSync;
    const ingest = yield* ImageIngest;
    const steps: Record<string, StepReport> = {};
    steps["events"] = yield* step(
      "events",
      Effect.map(sync.rehearse, (rehearsal) => ({
        syncedCount: rehearsal.syncedCount,
        changedCount: rehearsal.changedCount,
        publishedCount: rehearsal.publishedCount,
        created: rehearsal.created.map(({ slug, fields }) => ({
          slug,
          name: fields["name"],
        })),
        updated: rehearsal.updated.map(({ slug, changes }) => ({
          slug,
          changes,
        })),
      })),
    );
    steps["venues"] = yield* step(
      "venues",
      venues(yield* LumaVenues, limits, true),
    );
    steps["images"] = yield* step(
      "images",
      Effect.map(ingest.pending, (pending) => ({
        covers: pending.coversLookedUp
          ? pending.covers.map(({ slug }) => slug)
          : "skipped: no LUMA_API_KEY",
        photos: pending.photos.map(({ name }) => name),
        posts: pending.posts.map(({ postId, kind }) => `${postId} ${kind}`),
      })),
    );
    steps["followers"] = yield* step(
      "followers",
      yield* followers(limits, true),
    );
    return steps;
  });

/** One run in `mode`, within `limits`, logged and reported. Never fails. */
export const runSync = (mode: SyncMode, limits: SyncLimits) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    yield* log({ step: "start", mode });
    const steps = yield* mode === "write" ? write(limits) : dryRun(limits);
    const report: SyncReport = {
      mode,
      ok: Object.values(steps).every((outcome) => outcome.status !== "failed"),
      tookMs: (yield* Clock.currentTimeMillis) - started,
      steps,
    };
    yield* log({ step: "summary", mode, ok: report.ok, tookMs: report.tookMs });
    return report;
  });
