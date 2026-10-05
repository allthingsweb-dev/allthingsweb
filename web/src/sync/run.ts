import { ImageIngest } from "allthings-core/src/ingest/ingest.ts";
import { LumaDescriptions } from "allthings-core/src/luma/descriptions.ts";
import { LumaSync } from "allthings-core/src/luma/sync.ts";
import { Clock, Context, Duration, Effect, Exit } from "effect";

/**
 * One run of the hourly sync, as the app's cron runs it
 * (app/src/app/api/cron/luma-sync/route.ts): events from Luma's calendar
 * first, then their descriptions from Luma's API (which the app's cron does
 * not import), then the images still missing (profile photos, post images,
 * event covers), each image phase in its own time window. Every step
 * writes only what is missing or changed, so a run repeated, or one cut
 * short, leaves the database as consistent as before and the next run
 * carries on.
 *
 * - `write` writes, as the app's cron does.
 * - `dry-run` writes nothing: the event sync is rehearsed (its statement in
 *   a transaction that rolls back), the description import lists what it
 *   would change, and the image phases list what they would fetch, without
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
  /** Events asked about for their descriptions; every published one by default. */
  readonly descriptions: { readonly maxEvents?: number };
}

export const syncLimits = {
  /** The app's: 10 s for photos, 20 s for posts (at most 40), covers until 35 s, cut at 50 s. */
  paid: {
    startBefore: "35 seconds",
    cancelAfter: "50 seconds",
    photos: { window: "10 seconds" },
    posts: { window: "20 seconds", maxItems: 40 },
    covers: {},
    descriptions: {},
  },
  /**
   * Within 50 subrequests: the feed is one, each description one, and each
   * image at most six (a cover lookup and its fallback, a download and
   * three redirects), so two descriptions and two images of each kind are
   * at most 39.
   */
  free: {
    startBefore: "35 seconds",
    cancelAfter: "50 seconds",
    photos: { window: "10 seconds", maxItems: 2 },
    posts: { window: "20 seconds", maxItems: 2 },
    covers: { maxItems: 2 },
    descriptions: { maxEvents: 2 },
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
 * The description import (core's src/luma/descriptions.ts) within
 * `limits`, as a step reports it: which events it changed, each with its
 * summary.
 */
const descriptions = (
  importer: LumaDescriptions["Service"],
  limits: SyncLimits,
  dryRun: boolean,
) =>
  Effect.gen(function* () {
    const { maxEvents } = limits.descriptions;
    const result = yield* importer.run({
      dryRun,
      ...(maxEvents === undefined ? {} : { maxEvents }),
    });
    if (result._tag === "Skipped") return { skipped: result.reason };
    return {
      asked: result.asked,
      unavailable: result.unavailable,
      written: result.written,
      changes: result.changes.map((change) => ({
        slug: change.slug,
        summary: change.after.summary,
      })),
    };
  });

/** A run that writes, as the app's cron does, and imports descriptions. */
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
    // The app stops when the events fail: descriptions and images then
    // wait for a run that reads the calendar.
    if (steps["events"].status !== "done") return steps;

    steps["descriptions"] = yield* step(
      "descriptions",
      descriptions(yield* LumaDescriptions, limits, false),
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
    return steps;
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
    steps["descriptions"] = yield* step(
      "descriptions",
      descriptions(yield* LumaDescriptions, limits, true),
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
