import {
  Clock,
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { SqlClient } from "effect/sql/SqlClient";
import { displayName } from "../lockup.ts";
import { orDataSourceError } from "../sql.ts";
import { addPost } from "./add.ts";

/**
 * Finding posts about an evening, programmatically: search Bluesky's
 * public search (and X's, once the app has a key) for posts that link the
 * evening's Luma page or its page on the site, name it, or come from or
 * mention the people on its stage, in the days around it; score each the
 * same way every time (`scoreCandidate`); and add the ones that score
 * enough as `pending` posts. Nothing is ever approved here: an organizer
 * (or the agent as a first reader) approves or hides each one.
 *
 * - Bluesky: `app.bsky.feed.searchPosts` on api.bsky.app, keyless.
 * - X: the v2 search API with the app's bearer token (`X_BEARER_TOKEN`,
 *   from 1Password's "allthings X app" in the `allthings` vault). Without
 *   it, X is skipped. Recent search reaches seven days back;
 *   `X_SEARCH=archive` uses full-archive search, which pay-per-use access
 *   has. X bills each post a search returns ($0.005 on pay-per-use, once a
 *   UTC day), so `X_MAX_RESULTS` (25 unless set) bounds each request.
 */

/** Everything about an evening a post could point at. */
export interface EventSignals {
  readonly slug: string;
  readonly name: string;
  readonly topic: string | null;
  readonly startsAt: DateTime.Utc;
  readonly endsAt: DateTime.Utc;
  /** Links that are the evening: its Luma pages and its pages on the site. */
  readonly links: ReadonlyArray<string>;
  /** Hosting companies' names. */
  readonly hosts: ReadonlyArray<string>;
  /** Handles of everyone on its stage or running it, lowercased. */
  readonly xHandles: ReadonlyArray<string>;
  /**
   * Their X accounts by user id, which never changes (src/followers.ts):
   * a post is theirs by its author's id, whatever handle it has now.
   */
  readonly xUserIds: ReadonlyArray<string>;
  /** Handles of those whose X account isn't known by id yet, lowercased. */
  readonly xHandlesWithoutId: ReadonlyArray<string>;
  /** Each of them once, for X's `from:`: by id where it's known, else by handle. */
  readonly xFrom: ReadonlyArray<string>;
  readonly blueskyHandles: ReadonlyArray<string>;
}

/** A post a search found, before it is stored. */
export interface FoundPost {
  readonly platform: "x" | "bluesky";
  /** The post's URL, as the post tools take it. */
  readonly url: string;
  readonly authorHandle: string;
  /** The author's X user id, where the platform gives one. */
  readonly authorId?: string;
  readonly text: string;
  /** Every link it carries, expanded where the platform says. */
  readonly links: ReadonlyArray<string>;
  /** Handles it mentions, lowercased, without the @. */
  readonly mentions: ReadonlyArray<string>;
  readonly postedAt: DateTime.Utc;
}

export interface Scored {
  readonly score: number;
  /** Why, one line per point earned, for whoever reviews it. */
  readonly reasons: ReadonlyArray<string>;
}

/** What a post must score to be added as a candidate. */
export const candidateThreshold = 5;

/** How long before an evening, and after it, a post may be about it. */
export const windowBefore = Duration.days(14);
export const windowAfter = Duration.days(7);

const lower = (text: string) => text.toLowerCase();

/** A link without its scheme, www., trailing slash, query or fragment. */
export const bareLink = (url: string): string =>
  lower(url)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

/** Whether `text` has `phrase` as whole words. */
const hasPhrase = (text: string, phrase: string) =>
  phrase.trim() !== "" &&
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(text);

/**
 * How much `post` looks like it is about the evening, and why. The same
 * post and evening always score the same.
 */
export function scoreCandidate(
  signals: EventSignals,
  post: Pick<
    FoundPost,
    | "platform"
    | "authorHandle"
    | "authorId"
    | "text"
    | "links"
    | "mentions"
    | "postedAt"
  >,
): Scored {
  const reasons: Array<string> = [];
  const add = (points: number, why: string) => {
    reasons.push(`+${points} ${why}`);
    return points;
  };
  let score = 0;

  const ours = new Set(signals.links.map(bareLink));
  const linked = [...post.links, ...(post.text.match(/\S+\.\S+\/\S+/g) ?? [])]
    .map(bareLink)
    .find((link) => ours.has(link));
  if (linked !== undefined) score += add(6, `links ${linked}`);

  // Words are read from the text without its links, and the host from it
  // without the evening's name: neither counts twice.
  const words = post.text.replace(/\S+\.\S+\/\S*/g, " ");
  const name = displayName(signals.name);
  const named = name.split(/\s+/).length >= 2 && hasPhrase(words, name);
  if (named) score += add(4, `names "${name}"`);
  // The name, as people write it: "All Things Web", "allthings",
  // "#allthingsweb", "all things/effect". "All things <topic>" alone is
  // common English ("all things AI"), so it earns less.
  const topicLockup =
    signals.topic === null
      ? null
      : new RegExp(
          `all\\s*things\\s*/?\\s*${signals.topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
          "iu",
        );
  if (
    /all\s*things\s*web|allthings|#allthingsweb|all\s*things\s*\//i.test(words)
  ) {
    score += add(3, "says all things");
  } else if (topicLockup?.test(words) === true) {
    score += add(2, `says "all things ${signals.topic ?? ""}"`);
  } else if (signals.topic !== null && hasPhrase(words, signals.topic)) {
    score += add(1, `says ${signals.topic}`);
  }
  const unnamed = named
    ? words.replace(
        new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        " ",
      )
    : words;
  const host = signals.hosts.find((h) => hasPhrase(unnamed, h));
  if (host !== undefined) score += add(1, `names ${host}`);

  const handles =
    post.platform === "x" ? signals.xHandles : signals.blueskyHandles;
  // An X author is theirs by id where the post gives one: a handle can
  // change hands, so a handle counts only for someone whose id isn't known.
  const onStage =
    post.platform === "x" && post.authorId !== undefined
      ? signals.xUserIds.includes(post.authorId) ||
        signals.xHandlesWithoutId.includes(lower(post.authorHandle))
      : handles.includes(lower(post.authorHandle));
  if (onStage) {
    score += add(2, `by @${post.authorHandle}, on its stage`);
  }
  const mentioned = post.mentions.filter((m) => handles.includes(lower(m)));
  if (mentioned.length > 0) {
    score += add(
      Math.min(2, mentioned.length),
      `mentions ${mentioned.map((m) => `@${m}`).join(", ")}`,
    );
  }

  const posted = DateTime.toEpochMillis(post.postedAt);
  const night =
    posted >= DateTime.toEpochMillis(signals.startsAt) - 2 * 3_600_000 &&
    posted <= DateTime.toEpochMillis(signals.endsAt) + 12 * 3_600_000;
  if (night) score += add(2, "posted on the night");
  return { score, reasons };
}

/** Whether `postedAt` falls in the days a post may be about the evening. */
export const inWindow = (signals: EventSignals, postedAt: DateTime.Utc) =>
  DateTime.between(postedAt, {
    minimum: DateTime.subtractDuration(signals.startsAt, windowBefore),
    maximum: DateTime.addDuration(signals.endsAt, windowAfter),
  });

/**
 * The evening a post is about, of `evenings`: whichever it scores best for
 * among those whose window holds it, the nearest in time on a tie. A post
 * the search for one evening found may name, link or have been posted on
 * the night of another; it goes to that one. None when no window holds it.
 */
export function assignEvening<E extends EventSignals>(
  post: Pick<
    FoundPost,
    | "platform"
    | "authorHandle"
    | "authorId"
    | "text"
    | "links"
    | "mentions"
    | "postedAt"
  >,
  evenings: ReadonlyArray<E>,
): E | null {
  const distance = (evening: E) =>
    Math.abs(
      DateTime.toEpochMillis(evening.startsAt) -
        DateTime.toEpochMillis(post.postedAt),
    );
  let best: { evening: E; score: number } | null = null;
  for (const evening of evenings) {
    if (!inWindow(evening, post.postedAt)) continue;
    const { score } = scoreCandidate(evening, post);
    if (
      best === null ||
      score > best.score ||
      (score === best.score && distance(evening) < distance(best.evening))
    ) {
      best = { evening, score };
    }
  }
  return best?.evening ?? null;
}

/** A search platform could not be read; the evening's other searches go on. */
export class CandidateSearchError extends Schema.TaggedError<CandidateSearchError>()(
  "CandidateSearchError",
  {
    platform: Schema.String,
    reason: Schema.String,
    /** Requests sent before it failed, at most: a run's budget counts them. */
    requests: Schema.optionalKey(Schema.Number),
  },
) {}

/** What a search found, and how many requests it sent. */
export interface SearchResult {
  readonly posts: ReadonlyArray<FoundPost>;
  readonly requests: number;
}

export interface CandidateSearchShape {
  readonly platform: "x" | "bluesky";
  /**
   * Posts that might be about the evening, from this platform's search: at
   * most `maxQueries` requests, every query by default.
   */
  readonly search: (
    signals: EventSignals,
    maxQueries?: number,
  ) => Effect.Effect<SearchResult, CandidateSearchError>;
}

const BlueskyPost = Schema.Struct({
  uri: Schema.String,
  author: Schema.Struct({ handle: Schema.String }),
  record: Schema.Struct({
    text: Schema.String,
    createdAt: Schema.String,
    facets: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          features: Schema.Array(
            Schema.Struct({
              $type: Schema.String,
              uri: Schema.optionalKey(Schema.String),
              did: Schema.optionalKey(Schema.String),
              tag: Schema.optionalKey(Schema.String),
            }),
          ),
        }),
      ),
    ),
    embed: Schema.optionalKey(
      Schema.Struct({
        external: Schema.optionalKey(Schema.Struct({ uri: Schema.String })),
      }),
    ),
  }),
});

const BlueskySearch = Schema.Struct({ posts: Schema.Array(BlueskyPost) });

/** A Bluesky search hit as a found post; null when it can't be dated. */
export function fromBlueskyHit(hit: typeof BlueskyPost.Type): FoundPost | null {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(
    hit.uri,
  );
  const postedAt = DateTime.make(hit.record.createdAt);
  if (match === null || Option.isNone(postedAt)) return null;
  const features = (hit.record.facets ?? []).flatMap((f) => f.features);
  // Mentions name a DID in facets; the handle is in the text.
  const mentions = [
    ...hit.record.text.matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/gi),
  ].map((m) => lower(m[1] ?? ""));
  return {
    platform: "bluesky",
    url: `https://bsky.app/profile/${match[1]}/post/${match[2]}`,
    authorHandle: hit.author.handle,
    text: hit.record.text,
    links: [
      ...features.flatMap((f) => (f.uri === undefined ? [] : [f.uri])),
      ...(hit.record.embed?.external === undefined
        ? []
        : [hit.record.embed.external.uri]),
    ],
    mentions,
    postedAt: postedAt.value,
  };
}

const iso = (instant: DateTime.Utc) => DateTime.formatIso(instant);

/** The search window's ends for `signals`. */
const windowOf = (signals: EventSignals) => ({
  since: DateTime.subtractDuration(signals.startsAt, windowBefore),
  until: DateTime.addDuration(signals.endsAt, windowAfter),
});

/** Bluesky's public post search, keyless. Needs an `HttpClient`. */
export const makeBlueskySearch = Effect.gen(function* () {
  {
    const client = yield* HttpClient.HttpClient;
    const query = (params: Record<string, string>) =>
      Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.get(
            "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts",
          ).pipe(
            HttpClientRequest.setUrlParams({ limit: "100", ...params }),
            HttpClientRequest.acceptJson,
          ),
        );
        if (response.status !== 200) {
          return yield* new CandidateSearchError({
            platform: "bluesky",
            reason: `searchPosts answered ${response.status}`,
          });
        }
        const json = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(BlueskySearch)),
          Effect.mapError(
            () =>
              new CandidateSearchError({
                platform: "bluesky",
                reason: "searchPosts' answer is not a list of posts",
              }),
          ),
        );
        return json.posts.flatMap((hit) => {
          const post = fromBlueskyHit(hit);
          return post === null ? [] : [post];
        });
      }).pipe(
        Effect.timeout(Duration.seconds(20)),
        Effect.catchTags({
          HttpClientError: () =>
            Effect.fail(
              new CandidateSearchError({
                platform: "bluesky",
                reason: "no answer",
              }),
            ),
          TimeoutError: () =>
            Effect.fail(
              new CandidateSearchError({
                platform: "bluesky",
                reason: "no answer in 20 s",
              }),
            ),
        }),
      );

    return {
      platform: "bluesky",
      search: (signals, maxQueries) =>
        Effect.gen(function* () {
          const { since, until } = windowOf(signals);
          const window = {
            since: iso(since),
            until: iso(until),
            sort: "latest",
          };
          const topicWords = signals.topic ?? displayName(signals.name);
          const all: Array<Record<string, string>> = [
            ...signals.links
              .filter((link) => link.startsWith("https://"))
              // A link search takes no window (searchPosts refuses "*" with
              // one); posts outside it are dropped after.
              .map((url) => ({ q: "*", url, sort: "latest" })),
            { q: `"${displayName(signals.name)}"`, ...window },
            { q: `"all things" ${topicWords}`, ...window },
            ...signals.blueskyHandles.flatMap((handle) => [
              { q: topicWords, author: handle, ...window },
              { q: topicWords, mentions: handle, ...window },
            ]),
          ];
          // The strongest first: a budget keeps the links and the name.
          const queries = all.slice(0, maxQueries ?? all.length);
          if (queries.length === 0) return { posts: [], requests: 0 };
          const found = new Map<string, FoundPost>();
          // One refused query doesn't end the search; all of them do.
          const failures: Array<string> = [];
          for (const params of queries) {
            const result = yield* Effect.result(query(params));
            if (result._tag === "Failure") {
              failures.push(result.failure.reason);
              continue;
            }
            for (const post of result.success) found.set(post.url, post);
          }
          if (failures.length === queries.length) {
            return yield* new CandidateSearchError({
              platform: "bluesky",
              reason: `every query failed: ${[...new Set(failures)].join("; ")}`,
              requests: queries.length,
            });
          }
          return { posts: [...found.values()], requests: queries.length };
        }),
    } satisfies CandidateSearchShape;
  }
});

const XSearchAnswer = Schema.Struct({
  data: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        text: Schema.String,
        author_id: Schema.String,
        created_at: Schema.String,
        entities: Schema.optionalKey(
          Schema.Struct({
            urls: Schema.optionalKey(
              Schema.Array(
                Schema.Struct({
                  expanded_url: Schema.optionalKey(Schema.String),
                }),
              ),
            ),
            mentions: Schema.optionalKey(
              Schema.Array(Schema.Struct({ username: Schema.String })),
            ),
          }),
        ),
      }),
    ),
  ),
  includes: Schema.optionalKey(
    Schema.Struct({
      users: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({ id: Schema.String, username: Schema.String }),
        ),
      ),
    }),
  ),
});

/** An X search answer as found posts. */
export function fromXSearch(
  answer: typeof XSearchAnswer.Type,
): ReadonlyArray<FoundPost> {
  const users = new Map(
    (answer.includes?.users ?? []).map((u) => [u.id, u.username] as const),
  );
  return (answer.data ?? []).flatMap((tweet) => {
    const postedAt = DateTime.make(tweet.created_at);
    const handle = users.get(tweet.author_id);
    if (Option.isNone(postedAt) || handle === undefined) return [];
    return [
      {
        platform: "x" as const,
        url: `https://x.com/${handle}/status/${tweet.id}`,
        authorHandle: handle,
        authorId: tweet.author_id,
        text: tweet.text,
        links: (tweet.entities?.urls ?? []).flatMap((u) =>
          u.expanded_url === undefined ? [] : [u.expanded_url],
        ),
        mentions: (tweet.entities?.mentions ?? []).map((m) =>
          lower(m.username),
        ),
        postedAt: postedAt.value,
      },
    ];
  });
}

/** X's query for `signals`: the evening's links and name, or its people saying all things. */
export function xQueries(signals: EventSignals): ReadonlyArray<string> {
  const quoted = (s: string) => `"${s.replace(/"/g, "")}"`;
  const about = [
    ...signals.links.map((link) => `url:${quoted(bareLink(link))}`),
    quoted(displayName(signals.name)),
  ].join(" OR ");
  const people = signals.xFrom.map((who) => `from:${who}`).join(" OR ");
  const words = [
    quoted("all things"),
    ...(signals.topic === null ? [] : [quoted(signals.topic)]),
  ].join(" OR ");
  return [
    `(${about}) -is:retweet`,
    ...(people === "" ? [] : [`(${people}) (${words}) -is:retweet`]),
  ];
}

/**
 * Posts an X search request returns unless `X_MAX_RESULTS` says otherwise:
 * X bills each one, so a run's cost is at most its requests times this.
 */
export const xDefaultMaxResults = 25;

/** What X charges per post a search returns, on pay-per-use (docs.x.com, 2026-10). */
export const xCostPerPost = 0.005;

/**
 * X's v2 search with the app's bearer token, when `X_BEARER_TOKEN` is
 * configured; without it, a search that finds nothing and says why.
 */
export const makeXSearch = Effect.gen(function* () {
  {
    const token = yield* Config.option(Config.Redacted("X_BEARER_TOKEN"));
    const archive =
      (yield* Config.String("X_SEARCH").pipe(Config.withDefault("recent"))) ===
      "archive";
    // Each post a search returns is billed: at most this many a request.
    const maxResults = yield* Config.Int("X_MAX_RESULTS").pipe(
      Config.withDefault(xDefaultMaxResults),
    );
    const client = yield* HttpClient.HttpClient;
    if (Option.isNone(token)) {
      return {
        platform: "x",
        search: () =>
          Effect.fail(
            new CandidateSearchError({
              platform: "x",
              reason: "no X_BEARER_TOKEN: X is skipped until the app has one",
            }),
          ),
      } satisfies CandidateSearchShape;
    }
    const endpoint = archive
      ? "https://api.x.com/2/tweets/search/all"
      : "https://api.x.com/2/tweets/search/recent";
    // Full-archive search takes one request a second: requests are spaced
    // so, across evenings too, and a 429 waits for X's reset, at most 10 s,
    // then tries again, twice.
    const spacingMs = archive ? 1_100 : 0;
    let lastRequestAt = Number.NEGATIVE_INFINITY;
    const paced = <A, E, R>(request: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const wait = lastRequestAt + spacingMs - now;
        if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
        lastRequestAt = yield* Clock.currentTimeMillis;
        return yield* request;
      });
    /**
     * One request, tried again after a 429 while `budget` allows: every
     * attempt counts against its request limit, and none starts, nor waits,
     * past its deadline. An attempt that gets no answer in 15 s is a failed
     * query, never the whole search's end. None when the budget is spent.
     */
    const send = (
      request: HttpClientRequest.HttpClientRequest,
      budget: {
        spent: number;
        readonly limit: number;
        readonly deadline: number;
      },
    ) =>
      Effect.gen(function* () {
        for (let attempt = 0; budget.spent < budget.limit; attempt++) {
          if ((yield* Clock.currentTimeMillis) >= budget.deadline) return null;
          budget.spent++;
          const response = yield* paced(
            client.execute(request).pipe(
              Effect.timeout(Duration.seconds(15)),
              Effect.map((answer) => ({ answer, status: answer.status })),
              Effect.orElseSucceed(() => ({ answer: null, status: 0 })),
            ),
          );
          if (response.status !== 429 || attempt >= 2) return response;
          const reset = Number(response.answer?.headers["x-rate-limit-reset"]);
          const now = yield* Clock.currentTimeMillis;
          const untilReset = Number.isFinite(reset)
            ? reset * 1000 - now
            : 1_000;
          const wait = Math.min(10_000, Math.max(1_000, untilReset));
          if (now + wait >= budget.deadline) return response;
          yield* Effect.sleep(Duration.millis(wait));
        }
        return null;
      });
    return {
      platform: "x",
      search: (signals, maxQueries) =>
        Effect.gen(function* () {
          const { since, until } = windowOf(signals);
          // Recent search reaches seven days back, and not past now.
          const now = yield* DateTime.now;
          const earliest = archive
            ? since
            : DateTime.max(
                since,
                DateTime.subtractDuration(now, Duration.days(7)),
              );
          const latest = DateTime.min(
            until,
            DateTime.subtractDuration(now, Duration.seconds(30)),
          );
          if (DateTime.isGreaterThanOrEqualTo(earliest, latest))
            return { posts: [], requests: 0 };
          const found = new Map<string, FoundPost>();
          const queries = xQueries(signals).slice(0, maxQueries);
          if (queries.length === 0) return { posts: [], requests: 0 };
          // Every request counts, retries too, and none runs past 30 s in.
          const budget = {
            spent: 0,
            limit: maxQueries ?? Number.POSITIVE_INFINITY,
            deadline: (yield* Clock.currentTimeMillis) + 30_000,
          };
          // One refused query (a 429, say) keeps what the others found.
          const failures: Array<string> = [];
          for (const query of queries) {
            const sent = yield* send(
              HttpClientRequest.get(endpoint).pipe(
                HttpClientRequest.bearerToken(Redacted.value(token.value)),
                HttpClientRequest.setUrlParams({
                  query,
                  start_time: iso(earliest),
                  end_time: iso(latest),
                  max_results: String(
                    Math.min(archive ? 500 : 100, Math.max(10, maxResults)),
                  ),
                  "tweet.fields": "created_at,author_id,entities",
                  expansions: "author_id",
                  "user.fields": "username",
                }),
                HttpClientRequest.acceptJson,
              ),
              budget,
            );
            if (sent === null) {
              failures.push("no requests or time left for this query");
              continue;
            }
            if (sent.answer === null) {
              failures.push("no answer in 15 s");
              continue;
            }
            const response = sent.answer;
            if (response.status !== 200) {
              failures.push(`search answered ${response.status}`);
              continue;
            }
            // An answer that isn't a search result is one failed query; what
            // the others found stays.
            // The body too has 15 s: X may send its headers, then stall.
            const answer = yield* Effect.result(
              response.json.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(XSearchAnswer)),
                Effect.timeout(Duration.seconds(15)),
              ),
            );
            if (answer._tag === "Failure") {
              failures.push(
                answer.failure._tag === "TimeoutError"
                  ? "the answer stalled for 15 s"
                  : "the answer is not a search result",
              );
              continue;
            }
            for (const post of fromXSearch(answer.success)) {
              found.set(post.url, post);
            }
          }
          if (failures.length === queries.length) {
            return yield* new CandidateSearchError({
              platform: "x",
              reason: `every query failed: ${[...new Set(failures)].join("; ")}`,
              requests: budget.spent,
            });
          }
          return { posts: [...found.values()], requests: budget.spent };
        }),
    } satisfies CandidateSearchShape;
  }
});

/** The searches a run asks: Bluesky's, and X's (which says why when it has no key). */
export class CandidateSearches extends Context.Service<
  CandidateSearches,
  ReadonlyArray<CandidateSearchShape>
>()("allthings/CandidateSearches") {
  /** Needs an `HttpClient`; reads `X_BEARER_TOKEN` and `X_SEARCH` from config. */
  static readonly layer = Layer.effect(
    CandidateSearches,
    Effect.all([makeBlueskySearch, makeXSearch]),
  );
}

const SignalsRow = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  lumaEventId: Schema.NullOr(Schema.String),
  hosts: Schema.Array(Schema.String),
  people: Schema.Array(
    Schema.Struct({
      x: Schema.NullOr(Schema.String),
      xId: Schema.NullOr(Schema.String),
      bluesky: Schema.NullOr(Schema.String),
    }),
  ),
});

/** The site's origins, now and before: an evening's page is on either. */
export const siteOrigins = [
  "https://allthings.dev",
  "https://allthingsweb.dev",
];

/** A handle as profiles store it, lowercased, without its @; null when blank. */
const handleOf = (stored: string | null) => {
  const handle = lower(stored?.trim().replace(/^@/, "") ?? "");
  return handle === "" ? null : handle;
};

/** An evening's signals from its row, with its Luma page if it was found. */
export function toSignals(
  row: typeof SignalsRow.Type,
  lumaPage: string | null,
): EventSignals {
  const unique = (values: ReadonlyArray<string | null>) => [
    ...new Set(values.filter((v): v is string => v !== null)),
  ];
  return {
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    startsAt: row.startDate,
    endsAt: row.endDate,
    links: unique([
      ...(row.lumaEventId === null
        ? []
        : [
            `https://lu.ma/event/${row.lumaEventId}`,
            `https://luma.com/event/${row.lumaEventId}`,
          ]),
      lumaPage,
      ...siteOrigins.map((origin) => `${origin}/${row.slug}`),
    ]),
    hosts: row.hosts,
    xHandles: unique(row.people.map((p) => handleOf(p.x))),
    xUserIds: unique(row.people.map((p) => p.xId)),
    xHandlesWithoutId: unique(
      row.people.map((p) => (p.xId === null ? handleOf(p.x) : null)),
    ),
    xFrom: unique(row.people.map((p) => p.xId ?? handleOf(p.x))),
    blueskyHandles: unique(row.people.map((p) => handleOf(p.bluesky))),
  };
}

/** Which evenings to search. */
export type CandidateScope =
  | { readonly _tag: "Slugs"; readonly slugs: ReadonlyArray<string> }
  /** Every published evening that has started, the latest first. */
  | { readonly _tag: "Past" }
  /** Published evenings that ended in the last `within`, or are on now. */
  | { readonly _tag: "Recent"; readonly within: Duration.Input };

export interface CandidateOptions {
  readonly scope: CandidateScope;
  /** Find and score, and write nothing. */
  readonly dryRun: boolean;
  /** Search at most this many evenings. */
  readonly maxEvents?: number;
  /**
   * Send at most this many requests in all (Luma pages and search
   * queries), for a Worker with a subrequest limit; unbounded by default.
   * Each evening's Luma page and strongest queries go first.
   */
  readonly maxRequests?: number;
}

export interface CandidateReport {
  readonly slug: string;
  /** Per platform: how many posts its search found, or why it found none. */
  readonly searched: Readonly<Record<string, number | string>>;
  readonly candidates: ReadonlyArray<{
    readonly url: string;
    readonly score: number;
    readonly reasons: ReadonlyArray<string>;
    /** "added", "already there (approved)", "would add", or why it failed. */
    readonly outcome: string;
  }>;
}

/**
 * Searches each evening in `options.scope` and adds every post that scores
 * at least {@link candidateThreshold} as `pending` (never approved). Posts
 * already stored, on any evening, stay as they are.
 */
export const findCandidates = (options: CandidateOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const searches = yield* CandidateSearches;
    const client = yield* HttpClient.HttpClient;
    const now = yield* DateTime.now;

    const scope = options.scope;
    const recentSince =
      scope._tag === "Recent"
        ? DateTime.subtractDuration(now, Duration.fromInputUnsafe(scope.within))
        : now;
    // Which evenings, in the statement itself: no array or flag is sent as
    // a parameter, so every driver encodes it the same.
    const which =
      scope._tag === "Slugs"
        ? scope.slugs.length === 0
          ? sql`FALSE`
          : sql`e.slug IN ${sql.in(scope.slugs)}`
        : scope._tag === "Past"
          ? sql`TRUE`
          : // Ended, and within the window: an evening still on doesn't
            // take a slot from one that has finished.
            sql`e.end_date >= ${DateTime.toDateUtc(recentSince)}
              AND e.end_date < ${DateTime.toDateUtc(now)}`;
    const readRows = (where: typeof which) =>
      sql`
      SELECT e.slug, e.name, e.topic, e.start_date AS "startDate",
        e.end_date AS "endDate", e.luma_event_id AS "lumaEventId",
        COALESCE((
          SELECT json_agg(s.name ORDER BY es.created_at, s.id)
          FROM event_sponsors es JOIN sponsors s ON s.id = es.sponsor_id
          WHERE es.event_id = e.id
        ), '[]'::json) AS hosts,
        COALESCE((
          SELECT json_agg(json_build_object('x', p.twitter_handle,
            'xId', p.x_user_id, 'bluesky', p.bluesky_handle) ORDER BY p.id)
          FROM profiles p
          WHERE p.id IN (
            SELECT profile_id FROM event_people WHERE event_id = e.id
            UNION
            SELECT ts.speaker_id FROM talk_speakers ts
            JOIN event_talks et ON et.talk_id = ts.talk_id
            WHERE et.event_id = e.id)
        ), '[]'::json) AS people
      FROM events e
      WHERE e.is_draft = false AND e.start_date <= ${DateTime.toDateUtc(now)}
        AND ${where}
      ORDER BY e.start_date DESC, e.id`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SignalsRow))),
        orDataSourceError,
      );
    const rows = yield* readRows(which);
    const events = rows.slice(0, options.maxEvents ?? rows.length);
    // The evenings a post found for one of these may be about instead: any
    // whose window can overlap a searched one's, so within both windows'
    // span of the searched evenings. Past searches them all already.
    const span = Duration.sum(windowBefore, windowAfter);
    const [first, ...more] = events;
    const allRows =
      scope._tag === "Past" || first === undefined
        ? rows
        : yield* readRows(sql`e.end_date >= ${DateTime.toDateUtc(
            DateTime.subtractDuration(
              more.reduce(
                (earliest, row) => DateTime.min(earliest, row.startDate),
                first.startDate,
              ),
              span,
            ),
          )}
            AND e.start_date <= ${DateTime.toDateUtc(
              DateTime.addDuration(
                more.reduce(
                  (latest, row) => DateTime.max(latest, row.endDate),
                  first.endDate,
                ),
                span,
              ),
            )}`);
    // Luma pages read this run, by slug, so a post can be matched to them.
    const lumaPages = new Map<string, string | null>();

    /** The evening's Luma page, as Luma names it, or null. */
    const lumaPage = (lumaEventId: string) =>
      client
        .execute(HttpClientRequest.get(`https://luma.com/event/${lumaEventId}`))
        .pipe(
          Effect.flatMap((response) => response.text),
          Effect.map(
            (html) =>
              /<link rel="canonical" href="(https:\/\/luma\.com\/[^"]+)"/.exec(
                html,
              )?.[1] ?? null,
          ),
          Effect.timeout(Duration.seconds(15)),
        );

    // Requests left: a Luma page and each add are counted before they are
    // sent; a search may send at most what is left, and reports what it sent.
    let left = options.maxRequests ?? Number.POSITIVE_INFINITY;
    const spend = (wanted: number) => {
      const granted = Math.min(wanted, left);
      left -= granted;
      return granted;
    };
    // Luma pages that failed to read this run, which aren't tried again.
    const unreadable = new Set<string>();
    /**
     * The evening's signals with its Luma page, read once a run and
     * counted; none when its page is unread: no request was left to read
     * it, or reading it failed. A page read without a canonical link is
     * read, and gives none.
     */
    const readSignals = (row: typeof SignalsRow.Type) =>
      Effect.gen(function* () {
        if (unreadable.has(row.slug)) return null;
        if (lumaPages.has(row.slug)) {
          return toSignals(row, lumaPages.get(row.slug) ?? null);
        }
        if (row.lumaEventId === null) {
          lumaPages.set(row.slug, null);
          return toSignals(row, null);
        }
        if (spend(1) === 0) return null;
        const read = yield* Effect.result(lumaPage(row.lumaEventId));
        if (read._tag === "Failure") {
          unreadable.add(row.slug);
          return null;
        }
        lumaPages.set(row.slug, read.success);
        return toSignals(row, read.success);
      });
    const reports: Array<CandidateReport> = [];
    for (const row of events) {
      if (left <= 0) break;
      const signals = (yield* readSignals(row)) ?? toSignals(row, null);
      // Every other evening a post found here could be about, by its window.
      const others = allRows
        .filter((other) => other.slug !== row.slug)
        .map((other) => ({ row: other, window: toSignals(other, null) }));
      const searched: Record<string, number | string> = {};
      const found = new Map<string, FoundPost>();
      for (const search of searches) {
        if (left <= 0) {
          searched[search.platform] = "no requests left in this run";
          continue;
        }
        const result = yield* Effect.result(
          search.search(signals, Number.isFinite(left) ? left : undefined),
        );
        if (result._tag === "Failure") {
          spend(result.failure.requests ?? 0);
          searched[search.platform] = result.failure.reason;
          continue;
        }
        spend(result.success.requests);
        searched[search.platform] = result.success.posts.length;
        for (const post of result.success.posts) found.set(post.url, post);
      }
      const candidates: Array<CandidateReport["candidates"][number]> = [];
      for (const post of found.values()) {
        if (!inWindow(signals, post.postedAt)) continue;
        // Filed under the evening it's about, which may be another: each
        // whose window holds it is scored with its Luma page, so one isn't
        // lost on a link this run hasn't read. Without a request left to
        // read one, the post waits for a run that can.
        const evenings = [signals];
        let unread = false;
        for (const other of others) {
          if (!inWindow(other.window, post.postedAt)) continue;
          const read = yield* readSignals(other.row);
          if (read === null) {
            unread = true;
            break;
          }
          evenings.push(read);
        }
        if (unread) {
          const { score, reasons } = scoreCandidate(signals, post);
          candidates.push({
            url: post.url,
            score,
            reasons,
            outcome:
              "left for a later run: another evening's Luma page is unread",
          });
          continue;
        }
        const about = assignEvening(post, evenings) ?? signals;
        const { score, reasons } = scoreCandidate(about, post);
        if (score < candidateThreshold) continue;
        const elsewhere =
          about.slug === signals.slug ? "" : `for ${about.slug}: `;
        // Adding reads the post from its platform: one request.
        if (spend(1) === 0) {
          candidates.push({
            url: post.url,
            score,
            reasons,
            outcome: `${elsewhere}left for a later run`,
          });
          continue;
        }
        const added = yield* Effect.result(
          addPost(about.slug, post.url, {
            dryRun: options.dryRun,
            status: "pending",
          }),
        );
        const outcome =
          elsewhere +
          (added._tag === "Failure"
            ? `failed: ${added.failure.message}`
            : added.success._tag === "Added"
              ? "added"
              : added.success._tag === "WouldAdd"
                ? "would add"
                : `already there (${added.success.status}, ${added.success.eventSlug})`);
        candidates.push({ url: post.url, score, reasons, outcome });
      }
      candidates.sort(
        (a, b) => b.score - a.score || a.url.localeCompare(b.url),
      );
      reports.push({ slug: signals.slug, searched, candidates });
    }
    return reports;
  });
