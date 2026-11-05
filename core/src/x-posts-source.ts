import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import {
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

/**
 * Posts on X as X's own API gives them, with the app's bearer token
 * (X_BEARER_TOKEN, 1Password's "allthings X app", field "Bearer Token"),
 * for `bun run people posts` (src/x-posts-refresh.ts): someone's own
 * recent posts, to pick their standouts from, and posts by id, to read
 * their counts again. Read only, never written. X bills each post a read
 * returns ($0.005 on pay-per-use, once a UTC day per post), so a cache,
 * when given, keeps every answer in its directory for the day it names (the
 * caller's UTC day, from the Clock).
 */

/** A post as read: its id, author, when, its words and its public counts. */
export interface ReadPost {
  readonly id: string;
  /** The author's handle now, where the answer names it. */
  readonly handle: string | undefined;
  /** When it was posted, as X gives it (ISO 8601, UTC). */
  readonly createdAt: string;
  readonly text: string;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
}

/** X couldn't be read; nothing was written. */
export class XReadError extends Schema.TaggedError<XReadError>()("XReadError", {
  what: Schema.String,
  reason: Schema.String,
  retryable: Schema.Boolean,
}) {}

const Metrics = Schema.Struct({
  like_count: Schema.Int,
  retweet_count: Schema.Int,
  reply_count: Schema.Int,
  quote_count: Schema.Int,
});
const Tweet = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  created_at: Schema.String,
  author_id: Schema.optionalKey(Schema.String),
  public_metrics: Metrics,
  /** A long post's whole text; `text` is then cut. */
  note_tweet: Schema.optionalKey(Schema.Struct({ text: Schema.String })),
});
const Problem = Schema.Struct({
  resource_id: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
});
const Tweets = Schema.Struct({
  data: Schema.optionalKey(Schema.Array(Tweet)),
  includes: Schema.optionalKey(
    Schema.Struct({
      users: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({ id: Schema.String, username: Schema.String }),
        ),
      ),
    }),
  ),
  errors: Schema.optionalKey(Schema.Array(Problem)),
  meta: Schema.optionalKey(
    Schema.Struct({ next_token: Schema.optionalKey(Schema.String) }),
  ),
});
const User = Schema.Struct({
  data: Schema.Struct({ id: Schema.String, username: Schema.String }),
});

/** X's API escapes &, < and > in a post's text; its words, as written. */
export const unescapeText = (text: string): string =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const postOf = (
  tweet: typeof Tweet.Type,
  handles: ReadonlyMap<string, string>,
): ReadPost => ({
  id: tweet.id,
  handle:
    tweet.author_id === undefined ? undefined : handles.get(tweet.author_id),
  createdAt: tweet.created_at,
  text: unescapeText(tweet.note_tweet?.text ?? tweet.text),
  likes: tweet.public_metrics.like_count,
  reposts: tweet.public_metrics.retweet_count,
  replies: tweet.public_metrics.reply_count,
  quotes: tweet.public_metrics.quote_count,
});

export interface XPostsSourceShape {
  /** The account that has `handle` now: its id and handle as X writes it. */
  readonly account: (
    handle: string,
  ) => Effect.Effect<
    { readonly id: string; readonly handle: string },
    XReadError
  >;
  /**
   * The account's own posts since `since` (no reposts, no replies), latest
   * first, at most `max` (5 or more: X answers 5 to 100 a page, and bills
   * each, so no page asks past `max`).
   */
  readonly ownPosts: (
    userId: string,
    since: string,
    max: number,
  ) => Effect.Effect<ReadonlyArray<ReadPost>, XReadError>;
  /**
   * Posts by id, up to 100 a request: each id's post, or null where X no
   * longer serves it (deleted, or its account made private or suspended).
   */
  readonly posts: (
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, ReadPost | null>, XReadError>;
}

export class XPostsSource extends Context.Service<
  XPostsSource,
  XPostsSourceShape
>()("allthings/XPostsSource") {
  /**
   * X's API with X_BEARER_TOKEN; `cache`, when given, keeps each answer
   * in its directory for its day (YYYY-MM-DD, UTC). Needs an `HttpClient`.
   */
  static readonly xApi = (cache?: {
    readonly directory: string;
    readonly day: string;
    /** Read what the cache holds, and keep nothing new (a dry run). */
    readonly readOnly?: boolean;
  }) =>
    Layer.effect(
      XPostsSource,
      Effect.gen(function* () {
        const token = yield* Config.Redacted("X_BEARER_TOKEN");
        const client = yield* HttpClient.HttpClient;
        const fetchJson = (what: string, url: URL) =>
          Effect.gen(function* () {
            const response = yield* client.execute(
              HttpClientRequest.get(url.toString()).pipe(
                HttpClientRequest.bearerToken(Redacted.value(token)),
                HttpClientRequest.acceptJson,
              ),
            );
            if (response.status !== 200) {
              return yield* new XReadError({
                what,
                reason: `X answered ${response.status}`,
                retryable: response.status === 429 || response.status >= 500,
              });
            }
            return yield* response.json.pipe(
              Effect.mapError(
                () =>
                  new XReadError({
                    what,
                    reason: "X's answer isn't JSON",
                    retryable: false,
                  }),
              ),
            );
          }).pipe(
            Effect.timeout(Duration.seconds(20)),
            Effect.catchTags({
              HttpClientError: () =>
                Effect.fail(
                  new XReadError({
                    what,
                    reason: "no answer",
                    retryable: true,
                  }),
                ),
              TimeoutError: () =>
                Effect.fail(
                  new XReadError({
                    what,
                    reason: "no answer in 20 s",
                    retryable: true,
                  }),
                ),
            }),
            Effect.retry({
              schedule: Schedule.exponential(Duration.seconds(2)),
              times: 3,
              while: (error) => error.retryable,
            }),
          );
        // Each answer kept for its UTC day: X bills a post read once a day.
        const get = <S extends Schema.Top>(what: string, url: URL, schema: S) =>
          Effect.gen(function* () {
            const key = createHash("sha256")
              .update(url.toString())
              .digest("hex");
            const path =
              cache === undefined
                ? undefined
                : `${cache.directory}/${cache.day}-${key}.json`;
            const decode = Schema.decodeUnknownEffect(schema);
            // A missing, unreadable or malformed entry is a miss: X is read again.
            const cached =
              path === undefined
                ? undefined
                : yield* Effect.promise(async (): Promise<unknown> => {
                    try {
                      return await Bun.file(path).json();
                    } catch {
                      return undefined;
                    }
                  }).pipe(
                    Effect.flatMap((body) =>
                      body === undefined
                        ? Effect.succeed(undefined)
                        : decode(body).pipe(
                            Effect.orElseSucceed(() => undefined),
                          ),
                    ),
                  );
            if (cached !== undefined) return cached;
            const body = yield* fetchJson(what, url);
            const decoded = yield* decode(body).pipe(
              Effect.mapError(
                () =>
                  new XReadError({
                    what,
                    reason: "X's answer isn't what was asked for",
                    retryable: false,
                  }),
              ),
            );
            // Only an answer that decodes is kept, and never by a dry run.
            if (path !== undefined && cache?.readOnly !== true) {
              // Written whole, then renamed: a reader never sees half of it.
              // The cache only saves a read: one it can't keep (a full disk,
              // a directory it may not write) costs nothing but that, so the
              // answer X gave is used all the same.
              const partial = `${path}.${process.pid}.${randomUUID()}.partial`;
              yield* Effect.tryPromise(async () => {
                await mkdir(cache!.directory, { recursive: true });
                await Bun.write(partial, JSON.stringify(body));
                await rename(partial, path);
              }).pipe(
                Effect.catch(() =>
                  Effect.tryPromise(() => rm(partial, { force: true })).pipe(
                    Effect.ignore,
                  ),
                ),
              );
            }
            return decoded;
          });
        const api = (path: string, params: Record<string, string> = {}) => {
          const url = new URL(`https://api.x.com/2/${path}`);
          for (const [name, value] of Object.entries(params))
            url.searchParams.set(name, value);
          return url;
        };
        const tweetFields = "created_at,public_metrics,note_tweet,author_id";

        const account = (handle: string) =>
          get(
            `@${handle}`,
            api(`users/by/username/${encodeURIComponent(handle)}`),
            User,
          ).pipe(
            Effect.map(({ data }) => ({ id: data.id, handle: data.username })),
          );

        const ownPosts = (userId: string, since: string, max: number) =>
          Effect.gen(function* () {
            const found: Array<ReadPost> = [];
            let next: string | undefined;
            do {
              const page = yield* get(
                `posts of ${userId}`,
                api(`users/${encodeURIComponent(userId)}/tweets`, {
                  exclude: "retweets,replies",
                  start_time: since,
                  max_results: String(Math.min(100, max - found.length)),
                  "tweet.fields": tweetFields,
                  expansions: "author_id",
                  "user.fields": "username",
                  ...(next === undefined ? {} : { pagination_token: next }),
                }),
                Tweets,
              );
              const handles = new Map(
                (page.includes?.users ?? []).map((user) => [
                  user.id,
                  user.username,
                ]),
              );
              found.push(
                ...(page.data ?? []).map((tweet) => postOf(tweet, handles)),
              );
              next = page.meta?.next_token;
              // X answers 5 to 100 a page and bills each: never past `max`.
            } while (next !== undefined && max - found.length >= 5);
            return found.slice(0, max);
          });

        const posts = (ids: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            const found = new Map<string, ReadPost | null>();
            for (let start = 0; start < ids.length; start += 100) {
              const chunk = ids.slice(start, start + 100);
              const answer = yield* get(
                `${chunk.length} posts`,
                api("tweets", {
                  ids: chunk.join(","),
                  "tweet.fields": tweetFields,
                  expansions: "author_id",
                  "user.fields": "username",
                }),
                Tweets,
              );
              const handles = new Map(
                (answer.includes?.users ?? []).map((user) => [
                  user.id,
                  user.username,
                ]),
              );
              for (const tweet of answer.data ?? [])
                found.set(tweet.id, postOf(tweet, handles));
              for (const problem of answer.errors ?? []) {
                const id = problem.resource_id ?? problem.value;
                if (id !== undefined && !found.has(id)) found.set(id, null);
              }
            }
            return found;
          });

        return XPostsSource.of({ account, ownPosts, posts });
      }),
    );
}
