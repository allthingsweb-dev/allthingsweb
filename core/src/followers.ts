import {
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Order,
  Redacted,
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
 * The counts come from X's own API with the app's bearer token
 * (X_BEARER_TOKEN), which reads up to 100 accounts a request by user id
 * and is billed per user it returns ($0.010 on pay-per-use), or, without
 * the token, the keyless FixTweet API (api.fxtwitter.com). A refresh reads the profiles
 * whose snapshot is missing or oldest first, a bounded number per run, so
 * the sync Worker's schedule and the CLI (`bun run followers`) can both
 * run it; a handle X doesn't know, or a failed read, leaves the stored
 * snapshot as it was.
 *
 * A profile's X account is known by its numeric user id (`x_user_id`),
 * which never changes: people change handles, and X lets others take a
 * handle once it's free. The refresh stores the id the first time it reads
 * a handle. After that, a handle whose account has another id was taken by
 * someone else: the refresh never adopts it, but clears it, keeps the id,
 * and records the lost handle for the completeness report. Where the
 * source can look an account up by id (X's own API; FixTweet can't), it
 * reads by id, and a renamed account's new handle is stored as it is.
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
    id: Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/)),
    screen_name: Schema.String,
    followers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
});

/** An X account as read: its id, which never changes, its handle now, and how many follow it. */
export interface XAccount {
  readonly id: string;
  readonly handle: string;
  readonly followers: number;
}

export interface FollowerSourceShape {
  /** The account that has `handle` on X now. */
  readonly read: (handle: string) => Effect.Effect<XAccount, FollowerReadError>;
  /**
   * The account with user id `id`, whatever its handle is now, where the
   * source can look one up by id.
   */
  readonly readById?: (
    id: string,
  ) => Effect.Effect<XAccount, FollowerReadError>;
  /**
   * The accounts with these user ids, in as few requests as the source
   * allows: each id's account, or why it can't be read.
   */
  readonly readByIds?: (
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<
    ReadonlyMap<string, XAccount | FollowerReadError>,
    FollowerReadError
  >;
}

/** A user as X's API answers: its id, handle and public counts. */
const XApiUser = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/)),
  username: Schema.String,
  public_metrics: Schema.Struct({
    followers_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
});
const XApiOne = Schema.Struct({ data: XApiUser });
const XApiMany = Schema.Struct({
  data: Schema.optionalKey(Schema.Array(XApiUser)),
  errors: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        value: Schema.optionalKey(Schema.String),
        resource_id: Schema.optionalKey(Schema.String),
        title: Schema.optionalKey(Schema.String),
        detail: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
});

const accountOf = (user: typeof XApiUser.Type): XAccount => ({
  id: user.id,
  handle: user.username,
  followers: user.public_metrics.followers_count,
});

/** X's users lookup takes up to 100 ids a request. */
const idsPerRequest = 100;

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
          return {
            id: json.user.id,
            handle: json.user.screen_name,
            followers: json.user.followers,
          } satisfies XAccount;
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

  /**
   * Follower counts from X's own API with the app's bearer token
   * (X_BEARER_TOKEN): by handle, by user id, and by up to 100 ids a
   * request, so a renamed account is found by its id. X bills each user a
   * lookup returns ($0.010 on pay-per-use). Needs an `HttpClient`.
   */
  static readonly xApi = Layer.effect(
    FollowerSource,
    Effect.gen(function* () {
      const token = yield* Config.Redacted("X_BEARER_TOKEN");
      const client = yield* HttpClient.HttpClient;
      const get = <A>(
        what: string,
        url: string,
        params: Record<string, string>,
        decode: (body: unknown) => Effect.Effect<A, unknown>,
      ) =>
        Effect.gen(function* () {
          const response = yield* client.execute(
            HttpClientRequest.get(url).pipe(
              HttpClientRequest.bearerToken(Redacted.value(token)),
              HttpClientRequest.setUrlParams({
                "user.fields": "public_metrics",
                ...params,
              }),
              HttpClientRequest.acceptJson,
            ),
          );
          if (response.status !== 200) {
            return yield* new FollowerReadError({
              handle: what,
              reason: `X answered ${response.status}`,
              retryable: response.status === 429 || response.status >= 500,
            });
          }
          return yield* response.json.pipe(
            Effect.flatMap(decode),
            Effect.mapError(
              () =>
                new FollowerReadError({
                  handle: what,
                  reason: "X's answer is not a user",
                  retryable: false,
                }),
            ),
          );
        }).pipe(
          Effect.timeout(Duration.seconds(15)),
          Effect.catchTags({
            HttpClientError: () =>
              Effect.fail(
                new FollowerReadError({
                  handle: what,
                  reason: "no answer",
                  retryable: true,
                }),
              ),
            TimeoutError: () =>
              Effect.fail(
                new FollowerReadError({
                  handle: what,
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
      const read = (handle: string) =>
        get(
          handle,
          `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`,
          {},
          Schema.decodeUnknownEffect(XApiOne),
        ).pipe(Effect.map(({ data }) => accountOf(data)));
      const readById = (id: string) =>
        get(
          id,
          `https://api.x.com/2/users/${encodeURIComponent(id)}`,
          {},
          Schema.decodeUnknownEffect(XApiOne),
        ).pipe(Effect.map(({ data }) => accountOf(data)));
      const readByIds = (ids: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const found = new Map<string, XAccount | FollowerReadError>();
          for (let start = 0; start < ids.length; start += idsPerRequest) {
            const chunk = ids.slice(start, start + idsPerRequest);
            const answer = yield* get(
              `${chunk.length} ids`,
              "https://api.x.com/2/users",
              { ids: chunk.join(",") },
              Schema.decodeUnknownEffect(XApiMany),
            );
            for (const user of answer.data ?? []) {
              found.set(user.id, accountOf(user));
            }
            for (const error of answer.errors ?? []) {
              const id = error.resource_id ?? error.value;
              if (id === undefined || found.has(id)) continue;
              found.set(
                id,
                new FollowerReadError({
                  handle: id,
                  reason: `X has no such account: ${error.detail ?? error.title ?? "not found"}`,
                  retryable: false,
                }),
              );
            }
          }
          return found;
        });
      return FollowerSource.of({ read, readById, readByIds });
    }),
  );

  /**
   * X's own API where the app has its bearer token (X_BEARER_TOKEN), else
   * FixTweet. Needs an `HttpClient`.
   */
  static readonly fromConfig = Layer.unwrap(
    Effect.gen(function* () {
      const token = yield* Config.option(Config.Redacted("X_BEARER_TOKEN"));
      return Option.isSome(token)
        ? FollowerSource.xApi
        : FollowerSource.fxtwitter;
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
  /** Accounts found under a new handle, which was stored: `name: @old → @new`. */
  readonly renamed: ReadonlyArray<string>;
  /** Handles X now gives to another account, which were cleared. */
  readonly lost: ReadonlyArray<string>;
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
  xUserId: Schema.NullOr(Schema.String),
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
          x_followers AS "xFollowers", x_user_id AS "xUserId"
        FROM profiles
        WHERE twitter_handle IS NOT NULL AND btrim(twitter_handle) <> ''
          AND (x_followers_at IS NULL OR x_followers_at < ${before}
            OR x_user_id IS NULL)
        -- The least recently tried first: a handle that keeps failing goes
        -- behind the others instead of taking the same slots every run.
        ORDER BY x_followers_tried_at NULLS FIRST, x_followers_at NULLS FIRST, id`,
    });
    const due = (yield* orDataSourceError(findDue({ staleBefore }))).filter(
      (row) => xHandleOf(row.twitterHandle) !== null,
    );
    const batch = due.slice(0, Math.max(0, options.maxProfiles));

    const refreshed: Array<string> = [];
    const renamed: Array<string> = [];
    const lost: Array<string> = [];
    const failed: Array<string> = [];
    const write = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(Effect.mapError((cause) => new DataSourceError({ cause })));
    let unread = 0;
    // Every known id in as few requests as the source allows, within the
    // run's time. A batch X refuses (a 429, say) fails its profiles until a
    // later run, never one request each; one that runs out of time leaves
    // them unread.
    const ids = batch.flatMap((row) =>
      row.xUserId === null ? [] : [row.xUserId],
    );
    const prefetched = new Map<string, XAccount | FollowerReadError>();
    let prefetchOutOfTime = false;
    if (source.readByIds !== undefined && ids.length > 0) {
      const left =
        options.until === undefined
          ? null
          : DateTime.toEpochMillis(options.until) -
            DateTime.toEpochMillis(yield* DateTime.now);
      const batchRead = source.readByIds(ids);
      const read = yield* Effect.result(
        left === null
          ? batchRead.pipe(Effect.map(Option.some))
          : batchRead.pipe(Effect.timeoutOption(Math.max(0, left))),
      );
      if (read._tag === "Failure") {
        for (const id of ids) prefetched.set(id, read.failure);
      } else if (Option.isNone(read.success)) {
        prefetchOutOfTime = true;
      } else {
        for (const [id, account] of read.success.value) {
          prefetched.set(id, account);
        }
      }
    }
    for (const [index, row] of batch.entries()) {
      const handle = xHandleOf(row.twitterHandle) ?? "";
      // The batch ran out of the run's time: this and the rest wait.
      if (prefetchOutOfTime) {
        unread = batch.length - index;
        break;
      }
      const known =
        row.xUserId === null ? undefined : prefetched.get(row.xUserId);
      // By id where both are known: the account, whatever its handle now.
      const byId =
        known !== undefined
          ? known instanceof FollowerReadError
            ? Effect.fail(known)
            : Effect.succeed(known)
          : row.xUserId !== null && source.readById !== undefined
            ? source.readById(row.xUserId)
            : null;
      const reading = byId ?? source.read(handle);
      // What is left of the run's time, if it has an end.
      const left =
        options.until === undefined
          ? null
          : DateTime.toEpochMillis(options.until) -
            DateTime.toEpochMillis(yield* DateTime.now);
      const read = yield* Effect.result(
        left === null
          ? reading.pipe(Effect.map(Option.some))
          : reading.pipe(Effect.timeoutOption(Math.max(0, left))),
      );
      if (read._tag === "Success" && Option.isNone(read.success)) {
        unread = batch.length - index;
        break;
      }
      const at = DateTime.toDateUtc(yield* DateTime.now);
      if (!options.dryRun) {
        yield* write(sql`
          UPDATE profiles SET x_followers_tried_at = ${at}
          WHERE id = ${row.id}::uuid AND twitter_handle = ${row.twitterHandle}`);
      }
      if (read._tag === "Failure") {
        failed.push(`${row.name} (@${handle}): ${read.failure.reason}`);
        continue;
      }
      if (Option.isNone(read.success)) continue;
      const account = read.success.value;
      const sameHandle = account.handle.toLowerCase() === handle.toLowerCase();

      // The handle now belongs to another account: never adopt it.
      if (row.xUserId !== null && account.id !== row.xUserId) {
        if (!options.dryRun) {
          const cleared = yield* write(
            sql.withTransaction(
              Effect.gen(function* () {
                const rows = yield* sql`
                  UPDATE profiles SET twitter_handle = NULL, updated_at = now()
                  WHERE id = ${row.id}::uuid AND twitter_handle = ${row.twitterHandle}
                  RETURNING 1`;
                if (rows.length === 0) return false;
                // The trigger cleared what was known of the account; keep its id.
                yield* sql`
                  UPDATE profiles SET x_user_id = ${row.xUserId},
                    x_handle_lost = ${handle}, x_handle_lost_at = ${at},
                    x_followers_tried_at = ${at}
                  WHERE id = ${row.id}::uuid`;
                return true;
              }),
            ),
          );
          if (!cleared) {
            failed.push(
              `${row.name} (@${handle}): the handle changed while it was read`,
            );
            continue;
          }
        }
        lost.push(
          `${row.name}: @${handle} is now another X account's (${account.id}, not ${row.xUserId}); cleared`,
        );
        continue;
      }

      // Another profile already has this account.
      const [other] = yield* write(sql<{ name: string }>`
        SELECT name FROM profiles
        WHERE x_user_id = ${account.id} AND id <> ${row.id}::uuid`);
      if (other !== undefined) {
        failed.push(
          `${row.name} (@${handle}): ${other.name}'s profile has this X account (${account.id})`,
        );
        continue;
      }

      if (!options.dryRun) {
        const written = yield* write(
          sql.withTransaction(
            Effect.gen(function* () {
              // Found by id under a new handle: the same account, renamed.
              if (!sameHandle) {
                const rows = yield* sql`
                  UPDATE profiles SET twitter_handle = ${account.handle}, updated_at = now()
                  WHERE id = ${row.id}::uuid AND twitter_handle = ${row.twitterHandle}
                  RETURNING 1`;
                if (rows.length === 0) return false;
              }
              const rows = yield* sql`
                UPDATE profiles SET x_user_id = ${account.id},
                  x_followers = ${account.followers}, x_followers_at = ${at},
                  x_followers_tried_at = ${at}
                WHERE id = ${row.id}::uuid
                  AND twitter_handle = ${sameHandle ? row.twitterHandle : account.handle}
                RETURNING 1`;
              return rows.length > 0;
            }),
          ),
        );
        if (!written) {
          failed.push(
            `${row.name} (@${handle}): the handle changed while it was read`,
          );
          continue;
        }
      }
      if (!sameHandle) {
        renamed.push(`${row.name}: @${handle} → @${account.handle}`);
      }
      refreshed.push(
        `${row.name} (@${account.handle}): ${row.xFollowers ?? "∅"} → ${account.followers}`,
      );
    }
    return {
      refreshed,
      renamed,
      lost,
      failed,
      remaining: due.length - batch.length + unread,
    } satisfies RefreshReport;
  });
