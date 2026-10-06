import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Order,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { DataSourceError } from "./errors.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * How many follow each person on X, kept as a snapshot on their profile
 * (`x_followers`, read at `x_followers_at`), and the order speaker lists
 * take from it: most followed first. It is not an option anyone picks; it
 * is how the order is decided.
 *
 * The counts come from public data: the FixTweet API (api.fxtwitter.com)
 * now, X's own API once the app has keys. A refresh reads the profiles
 * whose snapshot is missing or oldest first, a bounded number per run, so
 * the sync Worker's schedule and the CLI (`bun run followers`) can both
 * run it; a handle X doesn't know, or a failed read, leaves the stored
 * snapshot as it was.
 */

/** A count as read: how many, and when. */
export interface FollowerSnapshot {
  readonly followers: number;
  readonly at: DateTime.Utc;
}

/**
 * Speaker order: whoever has a follower count first, most followed first,
 * then `then` (the list's own order) among equal counts and among those
 * without one, so people without X keep their old order after everyone
 * with a count.
 */
export const byFollowers = <A>(
  followers: (a: A) => number | null,
  then: Order.Order<A>,
): Order.Order<A> =>
  Order.combineAll([
    Order.mapInput(Order.Boolean, (a: A) => followers(a) === null),
    Order.flip(Order.mapInput(Order.Number, (a: A) => followers(a) ?? 0)),
    then,
  ]);

/** An X handle as profiles store it, with or without its @, or null. */
export function xHandleOf(stored: string | null): string | null {
  const handle = stored?.trim().replace(/^@/, "") ?? "";
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/** A follower count could not be read; the stored snapshot stays. */
export class FollowerReadError extends Schema.TaggedError<FollowerReadError>()(
  "FollowerReadError",
  { handle: Schema.String, reason: Schema.String, retryable: Schema.Boolean },
) {}

const FxUser = Schema.Struct({
  code: Schema.Number,
  user: Schema.Struct({
    screen_name: Schema.String,
    followers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
});

export interface FollowerSourceShape {
  /** How many follow `handle` on X now. */
  readonly read: (handle: string) => Effect.Effect<number, FollowerReadError>;
}

/** Follower counts from the FixTweet API, keyless. */
export class FollowerSource extends Context.Service<
  FollowerSource,
  FollowerSourceShape
>()("allthings/FollowerSource") {
  /** Needs an `HttpClient`. */
  static readonly fxtwitter = Layer.effect(
    FollowerSource,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const read = (handle: string) =>
        Effect.gen(function* () {
          const response = yield* client.execute(
            HttpClientRequest.get(
              `https://api.fxtwitter.com/${encodeURIComponent(handle)}`,
            ).pipe(HttpClientRequest.acceptJson),
          );
          if (response.status !== 200) {
            return yield* new FollowerReadError({
              handle,
              reason: `FixTweet answered ${response.status}`,
              retryable: response.status === 429 || response.status >= 500,
            });
          }
          const json = yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(FxUser)),
            Effect.mapError(
              () =>
                new FollowerReadError({
                  handle,
                  reason: "FixTweet's answer is not a profile",
                  retryable: false,
                }),
            ),
          );
          if (
            json.code !== 200 ||
            json.user.screen_name.toLowerCase() !== handle.toLowerCase()
          ) {
            return yield* new FollowerReadError({
              handle,
              reason: `FixTweet served @${json.user.screen_name} (code ${json.code})`,
              retryable: false,
            });
          }
          return json.user.followers;
        }).pipe(
          Effect.timeout(Duration.seconds(15)),
          Effect.catchTags({
            HttpClientError: () =>
              Effect.fail(
                new FollowerReadError({
                  handle,
                  reason: "no answer",
                  retryable: true,
                }),
              ),
            TimeoutError: () =>
              Effect.fail(
                new FollowerReadError({
                  handle,
                  reason: "no answer in 15 s",
                  retryable: true,
                }),
              ),
          }),
          Effect.retry({
            schedule: Schedule.exponential(Duration.seconds(1)),
            times: 2,
            while: (error) => error.retryable,
          }),
        );
      return FollowerSource.of({ read });
    }),
  );
}

/** How a refresh may run. */
export interface RefreshOptions {
  /** Write nothing: read the counts and report them. */
  readonly dryRun: boolean;
  /** Read at most this many profiles in one run. */
  readonly maxProfiles: number;
  /** A snapshot newer than this is left alone. */
  readonly staleAfter: Duration.Input;
  /**
   * Read nothing after this: a read still going is cut off, and what is
   * left waits for a later run (counted in `remaining`).
   */
  readonly until?: DateTime.Utc;
}

export interface RefreshReport {
  /** Profiles whose snapshot was read: `name: before → after`. */
  readonly refreshed: ReadonlyArray<string>;
  /** Profiles whose count could not be read, with why. */
  readonly failed: ReadonlyArray<string>;
  /** Stale profiles left for a later run, by `maxProfiles` or `until`. */
  readonly remaining: number;
}

const Due = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  twitterHandle: Schema.String,
  xFollowers: Schema.NullOr(Schema.Int),
});

/**
 * Reads the follower counts of profiles whose snapshot is missing or older
 * than `staleAfter`, oldest first, at most `maxProfiles`, and stores each
 * with the time it was read. Each profile is written on its own, so a run
 * cut short keeps what it read, and only while its X handle is still the one
 * read (the database clears a count whose handle changes).
 */
export const refreshFollowers = (options: RefreshOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const source = yield* FollowerSource;
    const now = yield* DateTime.now;
    const staleBefore = DateTime.subtractDuration(
      now,
      Duration.fromInputUnsafe(options.staleAfter),
    );

    const findDue = SqlSchema.findAll({
      Request: Schema.Struct({ staleBefore: Schema.DateTimeUtcFromDate }),
      Result: Due,
      execute: ({ staleBefore: before }) => sql`
        SELECT id, name, twitter_handle AS "twitterHandle",
          x_followers AS "xFollowers"
        FROM profiles
        WHERE twitter_handle IS NOT NULL AND btrim(twitter_handle) <> ''
          AND (x_followers_at IS NULL OR x_followers_at < ${before})
        ORDER BY x_followers_at NULLS FIRST, id`,
    });
    const due = (yield* orDataSourceError(findDue({ staleBefore }))).filter(
      (row) => xHandleOf(row.twitterHandle) !== null,
    );
    const batch = due.slice(0, Math.max(0, options.maxProfiles));

    const refreshed: Array<string> = [];
    const failed: Array<string> = [];
    let unread = 0;
    for (const [index, row] of batch.entries()) {
      const handle = xHandleOf(row.twitterHandle) ?? "";
      // What is left of the run's time, if it has an end.
      const left =
        options.until === undefined
          ? null
          : DateTime.toEpochMillis(options.until) -
            DateTime.toEpochMillis(yield* DateTime.now);
      const read = yield* Effect.result(
        left === null
          ? source.read(handle).pipe(Effect.map(Option.some))
          : source.read(handle).pipe(Effect.timeoutOption(Math.max(0, left))),
      );
      if (read._tag === "Failure") {
        failed.push(`${row.name} (@${handle}): ${read.failure.reason}`);
        continue;
      }
      if (Option.isNone(read.success)) {
        unread = batch.length - index;
        break;
      }
      const count = read.success.value;
      const at = yield* DateTime.now;
      if (!options.dryRun) {
        const written = yield* sql`
          UPDATE profiles SET x_followers = ${count},
            x_followers_at = ${DateTime.toDateUtc(at)}
          WHERE id = ${row.id}::uuid
            AND twitter_handle = ${row.twitterHandle}
          RETURNING 1`.pipe(
          Effect.mapError((cause) => new DataSourceError({ cause })),
        );
        if (written.length === 0) {
          failed.push(
            `${row.name} (@${handle}): the handle changed while it was read`,
          );
          continue;
        }
      }
      refreshed.push(
        `${row.name} (@${handle}): ${row.xFollowers ?? "∅"} → ${count}`,
      );
    }
    return {
      refreshed,
      failed,
      remaining: due.length - batch.length + unread,
    } satisfies RefreshReport;
  });
