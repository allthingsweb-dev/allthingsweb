import {
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
import { published } from "./catalog.ts";
import { DataSourceError } from "./errors.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * The community's public numbers, one snapshot a day, so they have a
 * history (`community_metrics`, migrations/0037_community_metrics.ts):
 * followers on X and Bluesky, YouTube subscribers, Discord members, the
 * Meetup group, Luma's guests, npm downloads of the CLI and GitHub stars.
 * The sync Worker takes it (web/src/sync/run.ts, `community`), and
 * `bun run community` shows it.
 *
 * Each day keeps the first value read for each source and metric: a source
 * that fails is read again on the next hourly run, until one succeeds or
 * the day ends. X bills each read, so it is read at most once a day: only
 * in the run of the day's first hour (UTC), whatever comes of it.
 *
 * A source that can't be read now is a **gap** or a **failure**
 * ({@link CommunityReadError}'s `temporary`, decided by
 * {@link isGapAnswer}). A gap is known and temporary: a rate limit or a
 * refusal, which public APIs answer Cloudflare's shared addresses at
 * times, a source down or slow, or npm's counts of a package too new to
 * have them. It is retried the next run and recorded in `community_gaps`
 * (migrations/0038_community_gaps.ts), so `bun run community` shows it, and
 * it never fails the sync. A failure needs someone: an answer that isn't
 * what it should be, a missing key, the database. So is a gap that lasts:
 * a source with no number for {@link gapDays} days.
 *
 * Every source is public, read without a key but X's app token (the
 * sync's own, X_BEARER_TOKEN): nothing here identifies anyone, only
 * counts of the community's own accounts.
 */

/** Where each number comes from. */
export const COMMUNITY = {
  /** allthings' own account, @allthingswebdev, by its user id. */
  xUserId: "1791650356667224064",
  blueskyHandle: "allthingsweb.dev",
  youtubeChannel: "https://www.youtube.com/@allthingsweb-dev/about",
  discordInvite: "B3Sm4b5mfD",
  meetupGroup: "reactjs-san-francisco",
  npmPackage: "allthings",
  githubRepo: "allthings-sf/allthingsweb",
} as const;

/** The sources, in the order they are shown. */
export const sources = [
  "x",
  "bluesky",
  "youtube",
  "discord",
  "meetup",
  "luma",
  "npm",
  "github",
] as const;

export type Source = (typeof sources)[number];

/** A source's metrics as read: whole counts, by name. */
export type Metrics = Readonly<Record<string, number>>;

/**
 * A source could not be read; it is tried again on a later run. A
 * `temporary` one is a gap, which needs no one; any other is a failure.
 */
export class CommunityReadError extends Schema.TaggedError<CommunityReadError>()(
  "CommunityReadError",
  { source: Schema.String, reason: Schema.String, temporary: Schema.Boolean },
) {}

/**
 * Whether a source's answer, `status` and not 200, is a gap: known and
 * temporary, so the next run reads it again and no one is told.
 *
 * - 429: a rate limit. Every source is read from Cloudflare's shared
 *   addresses, which other callers' traffic can exhaust (Discord's and
 *   npm's both have).
 * - 403: a refusal of the caller, which for these public APIs is a rate
 *   limit too (GitHub answers 403 when an address has used its hourly
 *   allowance) or a block of an address.
 * - 5xx: the source is down.
 * - npm's 404: npm's downloads API knows a package only a day or so after
 *   it is published.
 *
 * Any other answer is a failure: a page or an API that moved, or a request
 * of ours that is wrong. A refusal that lasts is one too ({@link gapDays}).
 */
export const isGapAnswer = (source: Source, status: number): boolean =>
  status === 429 ||
  status === 403 ||
  status >= 500 ||
  (source === "npm" && status === 404);

/**
 * How many days a source may go without a number, today included, while
 * each read is a gap. A source still a gap after that, read every hour for
 * two days and more without an answer, is no longer temporary: its gap is
 * a failure, until it answers.
 */
export const gapDays = 3;

/**
 * How long a 429 asks to wait, in seconds: its `Retry-After` header when
 * it is a number, else the `retry_after` its JSON body carries (Discord
 * sends both), else undefined (an HTTP date, or nothing).
 */
export function retryAfterSeconds(
  headers: Readonly<Record<string, string | undefined>>,
  body = "",
): number | undefined {
  const header = headers["retry-after"];
  if (header !== undefined && /^\d+(\.\d+)?$/.test(header.trim())) {
    // Hundreds of digits parse to Infinity: no wait at all.
    const seconds = Number(header.trim());
    return Number.isFinite(seconds) ? seconds : undefined;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    const value =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { readonly retry_after?: unknown }).retry_after
        : undefined;
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The sources asked once more, right away, when a 429 asks to wait at most
 * {@link shortRetrySeconds}: Discord, whose limit on Cloudflare's shared
 * addresses mostly asks for a second (`scope user, retry after 1 s`). One
 * retry only, so a run never waits more than that on it; a second 429 is a
 * gap, read again next hour.
 */
export const retriedOnShortLimit: ReadonlySet<Source> = new Set(["discord"]);

/** The longest wait a 429 may ask for and still be retried in the run. */
export const shortRetrySeconds = 5;

/**
 * Why a source answered `status` rather than 200, with what its answer says
 * about when to ask again: a rate limit's headers (how many requests are
 * left and when they reset, as GitHub and Discord send them, Discord's
 * scope, anyone's Retry-After) and Cloudflare's block of the caller's
 * address (error 1015), which only its body names. At most 200 characters.
 */
export function refusal(
  status: number,
  headers: Readonly<Record<string, string | undefined>>,
  body = "",
): string {
  const notes: Array<string> = [];
  if (/error code: 1015\b/.test(body)) {
    notes.push("Cloudflare 1015, the address is rate-limited");
  }
  const remaining = headers["x-ratelimit-remaining"];
  if (remaining !== undefined) notes.push(`${remaining} left`);
  // Seconds since the epoch, as both send it; past 8.64e12 s no Date is
  // valid, so a stray header can't throw here.
  const reset = Number(headers["x-ratelimit-reset"]);
  if (Number.isFinite(reset) && reset > 1e9 && reset <= 8.64e12) {
    notes.push(
      `resets ${new Date(Math.round(reset) * 1000).toISOString().slice(11, 16)} UTC`,
    );
  }
  if (headers["x-ratelimit-global"] === "true") notes.push("global");
  const scope = headers["x-ratelimit-scope"];
  if (scope !== undefined) notes.push(`scope ${scope}`);
  const retry = headers["retry-after"];
  if (retry !== undefined) {
    notes.push(
      `retry after ${retry}${/^\d+(\.\d+)?$/.test(retry) ? " s" : ""}`,
    );
  }
  const reason =
    notes.length === 0
      ? `answered ${status}`
      : `answered ${status} (${notes.join(", ")})`;
  return reason.slice(0, 200);
}

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const XUser = Schema.Struct({
  data: Schema.Struct({
    public_metrics: Schema.Struct({
      followers_count: count,
      following_count: count,
      tweet_count: count,
      listed_count: count,
    }),
  }),
});

const BlueskyProfile = Schema.Struct({
  followersCount: count,
  followsCount: count,
  postsCount: count,
});

const DiscordInvite = Schema.Struct({
  approximate_member_count: count,
  approximate_presence_count: count,
});

const MeetupGroup = Schema.Struct({
  data: Schema.Struct({
    groupByUrlname: Schema.Struct({
      stats: Schema.Struct({
        memberCounts: Schema.Struct({ all: count }),
      }),
    }),
  }),
});

const NpmDownloads = Schema.Struct({ downloads: count });

const GitHubRepo = Schema.Struct({
  stargazers_count: count,
  forks_count: count,
});

/**
 * A count YouTube writes as text in its channel page ("1,234 subscribers",
 * "1.2K subscribers"): the number, or undefined when the page has none.
 */
export function youtubeCount(
  page: string,
  field: "subscriberCountText" | "viewCountText",
): number | undefined {
  const text = new RegExp(`"${field}":"([^"]*)"`).exec(page)?.[1];
  const found = /^([0-9][0-9,.]*)\s*([KMB]?)\b/.exec(text ?? "");
  if (found?.[1] === undefined) return undefined;
  const scale = { "": 1, K: 1e3, M: 1e6, B: 1e9 }[found[2] ?? ""] ?? 1;
  const value = Number(found[1].replaceAll(",", "")) * scale;
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

/** How each source is read. */
export interface CommunitySourcesShape {
  readonly read: (source: Source) => Effect.Effect<Metrics, CommunityReadError>;
}

export class CommunitySources extends Context.Service<
  CommunitySources,
  CommunitySourcesShape
>()("allthings/CommunitySources") {
  /**
   * Each source from its public API (or YouTube's channel page), Luma's
   * from the database the sync writes it to. Needs an `HttpClient`, a
   * `SqlClient` and X_BEARER_TOKEN. With GITHUB_TOKEN, GitHub is read with
   * it, in that token's own allowance rather than the caller's address's
   * (GitHub Actions' built-in token, `.github/workflows/community.yaml`);
   * the sync Worker has none and reads GitHub without a key.
   */
  static readonly live = Layer.effect(
    CommunitySources,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const sql = yield* SqlClient;
      // Without it, X alone fails; a dry run never reads X.
      const githubToken = yield* Config.option(Config.Redacted("GITHUB_TOKEN"));
      const xToken = yield* Config.option(Config.Redacted("X_BEARER_TOKEN"));
      /**
       * `request` for `source`, within 15 s: its answer when 200, else a
       * read error, a gap or a failure as `isGapAnswer` says, with why
       * (`refusal`); no answer in time is a gap. A source in
       * `retriedOnShortLimit` whose 429 asks to wait at most
       * `shortRetrySeconds` is asked once more after that wait.
       */
      const get = (
        source: Source,
        request: HttpClientRequest.HttpClientRequest,
      ) =>
        Effect.gen(function* () {
          /** One request: its answer, and a refusal's body, which says why. */
          const send = Effect.gen(function* () {
            const response = yield* client.execute(
              request.pipe(
                HttpClientRequest.setHeader("user-agent", "allthings.dev"),
              ),
            );
            // Only a refusal's body says why (Cloudflare's 1015), or how
            // long to wait (Discord's retry_after).
            const body =
              response.status === 403 || response.status === 429
                ? yield* response.text.pipe(
                    Effect.orElseSucceed(() => ""),
                    Effect.map((text) => text.slice(0, 2000)),
                  )
                : "";
            return { response, body };
          });
          let { response, body } = yield* send;
          const wait =
            response.status === 429 && retriedOnShortLimit.has(source)
              ? retryAfterSeconds(response.headers, body)
              : undefined;
          if (wait !== undefined && wait <= shortRetrySeconds) {
            yield* Effect.sleep(Duration.millis(Math.ceil(wait * 1000)));
            ({ response, body } = yield* send);
          }
          if (response.status !== 200) {
            const temporary = isGapAnswer(source, response.status);
            return yield* new CommunityReadError({
              source,
              reason: refusal(response.status, response.headers, body),
              temporary,
            });
          }
          return response;
        }).pipe(
          Effect.timeout(Duration.seconds(15)),
          Effect.catchTags({
            // Not reached, or no answer in time: the source is down or slow.
            HttpClientError: () =>
              Effect.fail(
                new CommunityReadError({
                  source,
                  reason: "no answer",
                  temporary: true,
                }),
              ),
            TimeoutError: () =>
              Effect.fail(
                new CommunityReadError({
                  source,
                  reason: "no answer in 15 s",
                  temporary: true,
                }),
              ),
          }),
        );
      /**
       * `request` for `source` as JSON decoded by `schema`: an answer of
       * any other shape is a failure, since the API moved.
       */
      const json = <S extends Schema.Top>(
        source: Source,
        schema: S,
        request: HttpClientRequest.HttpClientRequest,
      ) =>
        get(source, request.pipe(HttpClientRequest.acceptJson)).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(schema)),
          Effect.mapError((error) =>
            error instanceof CommunityReadError
              ? error
              : // The API moved: someone has to look.
                new CommunityReadError({
                  source,
                  reason: "the answer is not what it should be",
                  temporary: false,
                }),
          ),
        ) as Effect.Effect<S["Type"], CommunityReadError>;

      const readers: Record<
        Source,
        Effect.Effect<Metrics, CommunityReadError>
      > = {
        x: Option.match(xToken, {
          onNone: () =>
            Effect.fail(
              new CommunityReadError({
                source: "x",
                reason: "no X_BEARER_TOKEN",
                temporary: false,
              }),
            ),
          onSome: (token) =>
            json(
              "x",
              XUser,
              HttpClientRequest.get(
                `https://api.x.com/2/users/${COMMUNITY.xUserId}`,
              ).pipe(
                HttpClientRequest.bearerToken(Redacted.value(token)),
                HttpClientRequest.setUrlParam("user.fields", "public_metrics"),
              ),
            ).pipe(
              Effect.map(({ data: { public_metrics: m } }) => ({
                followers: m.followers_count,
                following: m.following_count,
                posts: m.tweet_count,
                listed: m.listed_count,
              })),
            ),
        }),
        bluesky: json(
          "bluesky",
          BlueskyProfile,
          HttpClientRequest.get(
            "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
          ).pipe(
            HttpClientRequest.setUrlParam("actor", COMMUNITY.blueskyHandle),
          ),
        ).pipe(
          Effect.map((profile) => ({
            followers: profile.followersCount,
            following: profile.followsCount,
            posts: profile.postsCount,
          })),
        ),
        youtube: get(
          "youtube",
          HttpClientRequest.get(COMMUNITY.youtubeChannel).pipe(
            HttpClientRequest.setHeader("accept-language", "en-US"),
          ),
        ).pipe(
          Effect.flatMap((response) =>
            Effect.mapError(
              response.text,
              () =>
                new CommunityReadError({
                  source: "youtube",
                  reason: "no page",
                  temporary: true,
                }),
            ),
          ),
          Effect.flatMap((page) => {
            const subscribers = youtubeCount(page, "subscriberCountText");
            const views = youtubeCount(page, "viewCountText");
            return subscribers === undefined
              ? Effect.fail(
                  new CommunityReadError({
                    source: "youtube",
                    reason: "the channel page shows no subscriber count",
                    temporary: false,
                  }),
                )
              : Effect.succeed({
                  subscribers,
                  ...(views === undefined ? {} : { views }),
                });
          }),
        ),
        discord: json(
          "discord",
          DiscordInvite,
          HttpClientRequest.get(
            `https://discord.com/api/v10/invites/${COMMUNITY.discordInvite}`,
          ).pipe(HttpClientRequest.setUrlParam("with_counts", "true")),
        ).pipe(
          Effect.map((invite) => ({
            members: invite.approximate_member_count,
            online: invite.approximate_presence_count,
          })),
        ),
        meetup: json(
          "meetup",
          MeetupGroup,
          HttpClientRequest.post("https://api.meetup.com/gql-ext").pipe(
            HttpClientRequest.bodyJsonUnsafe({
              query: `query { groupByUrlname(urlname: "${COMMUNITY.meetupGroup}") { stats { memberCounts { all } } } }`,
            }),
          ),
        ).pipe(
          Effect.map(({ data }) => ({
            members: data.groupByUrlname.stats.memberCounts.all,
          })),
        ),
        luma: sql<{ guests: number; checked_in: number; events: number }>`
            SELECT COALESCE(sum(e.luma_guest_count), 0)::int AS guests,
              COALESCE(sum(e.luma_checked_in_count), 0)::int AS checked_in,
              count(*)::int AS events
            FROM events e
            WHERE e.luma_event_id IS NOT NULL AND ${published(sql, "e")}`.pipe(
          Effect.map(([row]) => ({
            guests: row?.guests ?? 0,
            checked_in: row?.checked_in ?? 0,
            events: row?.events ?? 0,
          })),
          Effect.mapError(
            () =>
              new CommunityReadError({
                source: "luma",
                reason: "the database didn't answer",
                temporary: false,
              }),
          ),
        ),
        npm: Effect.all({
          day: json(
            "npm",
            NpmDownloads,
            HttpClientRequest.get(
              `https://api.npmjs.org/downloads/point/last-day/${COMMUNITY.npmPackage}`,
            ),
          ),
          week: json(
            "npm",
            NpmDownloads,
            HttpClientRequest.get(
              `https://api.npmjs.org/downloads/point/last-week/${COMMUNITY.npmPackage}`,
            ),
          ),
        }).pipe(
          Effect.map(({ day, week }) => ({
            downloads_day: day.downloads,
            downloads_week: week.downloads,
          })),
        ),
        github: json(
          "github",
          GitHubRepo,
          HttpClientRequest.get(
            `https://api.github.com/repos/${COMMUNITY.githubRepo}`,
          ).pipe((request) =>
            Option.match(githubToken, {
              onNone: () => request,
              onSome: (token) =>
                HttpClientRequest.bearerToken(request, Redacted.value(token)),
            }),
          ),
        ).pipe(
          Effect.map((repo) => ({
            stars: repo.stargazers_count,
            forks: repo.forks_count,
          })),
        ),
      };
      // One deadline for a source's whole read, bodies included (npm makes
      // two requests), so a source that stalls never holds the run.
      return CommunitySources.of({
        read: (source) =>
          readers[source].pipe(
            Effect.timeout(Duration.seconds(35)),
            Effect.catchTag("TimeoutError", () =>
              Effect.fail(
                new CommunityReadError({
                  source,
                  reason: "no answer in 35 s",
                  temporary: true,
                }),
              ),
            ),
          ),
      });
    }),
  );
}

/** What one snapshot did, for the sync's log line. */
export interface CommunityReport {
  /** The day it is for (UTC), as `YYYY-MM-DD`. */
  readonly day: string;
  /** In a dry run, what each source read would store; nothing is written. */
  readonly wouldStore?: Readonly<Partial<Record<Source, Metrics>>>;
  /** Sources read now, successfully (a dry run reads those the day has too). */
  readonly read: ReadonlyArray<Source>;
  /** Sources read and stored now. */
  readonly stored: ReadonlyArray<Source>;
  /** Sources the day already had. */
  readonly kept: ReadonlyArray<Source>;
  /** Sources not read now, and why. */
  readonly skipped: Readonly<Partial<Record<Source, string>>>;
  /**
   * Sources not read now for a known, temporary reason, and why: tried
   * again on the next run, recorded in `community_gaps`, and nobody's to
   * act on.
   */
  readonly gaps: Readonly<Partial<Record<Source, string>>>;
  /**
   * Sources that failed in a way someone has to act on, and why: tried
   * again on the next run, and the step fails until none is left.
   */
  readonly failed: Readonly<Partial<Record<Source, string>>>;
}

/**
 * What in a snapshot someone has to act on, or undefined when nothing: its
 * failures, each source with why. Skips and gaps never are: X outside the
 * day's first hour, a rate limit, a refusal, a source down, npm's counts
 * not out yet. The sync fails its `community` step on this alone
 * (web/src/sync/run.ts), and a failed step is what the hourly sync's
 * alerts read (infra/src/alerts.ts).
 */
export const needsAction = (
  report: Pick<CommunityReport, "failed">,
): string | undefined => {
  const failed = Object.entries(report.failed);
  return failed.length === 0
    ? undefined
    : `needs action: ${failed
        .map(([source, reason]) => `${source} (${reason})`)
        .join(", ")}`;
};

/** The UTC day of `now`, as `YYYY-MM-DD`. */
const dayOf = (now: DateTime.Utc) => DateTime.formatIsoDateUtc(now);

/**
 * Of the sources whose read was a gap now, those that have had no number
 * for {@link gapDays} days, today included, each with the day it was last
 * read, or `undefined` if never. Read on day L, the third day after it is
 * its third without a number; never read, its first gap's day is its first
 * without one, so the third is two days after it.
 */
const lastingGaps = (
  sql: SqlClient,
  now: DateTime.Utc,
  gapped: ReadonlyArray<Source>,
) =>
  Effect.gen(function* () {
    if (gapped.length === 0) return new Map<Source, string | undefined>();
    /** Each source's day, from rows of both. */
    const since = (rows: ReadonlyArray<{ source: string; day: string }>) =>
      new Map(rows.map(({ source, day }) => [source, day]));
    const read = since(
      yield* orDataSourceError(
        sql<{ source: string; day: string }>`
          SELECT source, to_char(max(day), 'YYYY-MM-DD') AS day
          FROM community_metrics WHERE source IN ${sql.in(gapped)}
          GROUP BY source`,
      ),
    );
    const firstGap = since(
      yield* orDataSourceError(
        sql<{ source: string; day: string }>`
          SELECT source, to_char(min(day), 'YYYY-MM-DD') AS day
          FROM community_gaps WHERE source IN ${sql.in(gapped)}
          GROUP BY source`,
      ),
    );
    // The first day of the span with no number allowed.
    const oldest = dayOf(DateTime.subtract(now, { days: gapDays - 1 }));
    const lasting = new Map<Source, string | undefined>();
    for (const source of gapped) {
      const lastRead = read.get(source);
      const lasted =
        lastRead === undefined
          ? (firstGap.get(source) ?? dayOf(now)) <= oldest
          : lastRead < oldest;
      if (lasted) lasting.set(source, lastRead);
    }
    return lasting;
  });

/**
 * Takes today's snapshot (UTC): reads every source the day has no row
 * for yet and stores what it reads, one row per metric. X only in the
 * day's first hour. A source that can't be read is left for the next run:
 * a gap (`gaps`) when its reason is known and temporary
 * ({@link CommunityReadError}'s `temporary`), recorded in `community_gaps`
 * with how often it was tried, else, or when it has lasted
 * {@link gapDays} days, a failure (`failed`). The snapshot itself fails
 * only when the database does. A dry run reads the same sources but X and
 * reports what it would store (`wouldStore`), writing nothing, gaps
 * included. `only` limits it to those sources: the others are neither read
 * nor checked (GitHub Actions' snapshot of GitHub alone,
 * scripts/community-snapshot.ts).
 */
export const snapshotCommunity = ({
  dryRun = false,
  only,
}: {
  readonly dryRun?: boolean;
  readonly only?: ReadonlyArray<Source>;
} = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const reader = yield* CommunitySources;
    const now = yield* DateTime.now;
    const day = dayOf(now);
    const had = yield* orDataSourceError(
      sql<{ source: string }>`
        SELECT DISTINCT source FROM community_metrics WHERE day = ${day}`,
    );
    const kept = new Set(had.map(({ source }) => source));
    const stored: Array<Source> = [];
    const answered: Array<Source> = [];
    const wouldStore: Partial<Record<Source, Metrics>> = {};
    const skipped: Partial<Record<Source, string>> = {};
    const gaps: Partial<Record<Source, string>> = {};
    const failed: Partial<Record<Source, string>> = {};
    for (const source of sources) {
      if (only !== undefined && !only.includes(source)) continue;
      // A dry run reads every source but X, those the day has too, so it
      // checks each integration; it would store only what the day lacks.
      if (kept.has(source) && !(dryRun && source !== "x")) continue;
      if (source === "x" && dryRun) {
        // The plan says whether this hour's run would try X.
        skipped.x =
          DateTime.getPartUtc(now, "hour") === 0
            ? "a dry run never reads X, which bills each read; this hour's run would attempt to read it"
            : "a dry run never reads X, which bills each read; this hour's run wouldn't either (only the day's first hour, UTC)";
        continue;
      }
      if (source === "x" && DateTime.getPartUtc(now, "hour") !== 0) {
        skipped.x =
          "read only in the day's first hour (UTC): X bills each read";
        continue;
      }
      const read = yield* Effect.result(reader.read(source));
      if (read._tag === "Failure") {
        (read.failure.temporary ? gaps : failed)[source] = read.failure.reason;
        continue;
      }
      const rows = Object.entries(read.success).map(([metric, value]) => ({
        day,
        source,
        metric,
        value,
      }));
      answered.push(source);
      if (rows.length === 0) continue;
      if (dryRun) {
        if (!kept.has(source)) wouldStore[source] = read.success;
        continue;
      }
      // The day's first value stays: a second writer never replaces it.
      yield* orDataSourceError(
        sql`INSERT INTO community_metrics ${sql.insert(rows)}
          ON CONFLICT (day, source, metric) DO NOTHING`,
      );
      stored.push(source);
    }
    const gapped = sources.filter((source) => gaps[source] !== undefined);
    if (!dryRun) {
      // One row per day and source: its latest reason, and how often. Each
      // its own statement: `excluded.*` would need site_sync to read the
      // reasons, which it never does.
      const at = DateTime.formatIso(now);
      for (const source of gapped) {
        const reason = gaps[source] ?? "";
        yield* orDataSourceError(
          sql`INSERT INTO community_gaps ${sql.insert({
            day,
            source,
            reason,
            first_at: at,
            last_at: at,
          })}
            ON CONFLICT (day, source) DO UPDATE SET
              reason = ${reason},
              tries = community_gaps.tries + 1,
              last_at = ${at}`,
        );
      }
    }
    // X is read in the day's first hour only, so its gap stands until a
    // later day's read: the runs in between check it again, without
    // reading X, today's first-hour run or not, and a lasting one stays a
    // failure until X is read. Open means a gap after X's last number.
    const xGapOpen =
      !dryRun &&
      skipped.x !== undefined &&
      !kept.has("x") &&
      (yield* orDataSourceError(
        sql`SELECT 1 AS gap FROM community_gaps g
          WHERE g.source = 'x' AND g.day > COALESCE(
            (SELECT max(m.day) FROM community_metrics m WHERE m.source = 'x'),
            '-infinity'::date)
          LIMIT 1`,
      )).length > 0;
    // A gap that has lasted is no longer temporary.
    for (const [source, lastRead] of yield* lastingGaps(
      sql,
      now,
      xGapOpen ? [...gapped, "x"] : gapped,
    )) {
      failed[source] =
        `no number ${lastRead === undefined ? "yet" : `since ${lastRead}`}, ${gapDays} days of gaps: ${gaps[source] ?? "a gap when X was last read, in a day's first hour"}`;
      delete gaps[source];
    }
    return {
      day,
      stored,
      read: answered,
      ...(dryRun ? { wouldStore } : {}),
      kept: sources.filter((source) => kept.has(source)),
      skipped,
      gaps,
      failed,
    } satisfies CommunityReport;
  });

/** One stored number. */
export interface CommunityRow {
  readonly day: string;
  readonly source: string;
  readonly metric: string;
  readonly value: number;
}

/** The UTC days of the last `days` days, today included: the first and last. */
const span = (now: DateTime.Utc, days: number) => ({
  since: dayOf(DateTime.subtract(now, { days: Math.max(0, days - 1) })),
  until: dayOf(now),
});

/**
 * The snapshots of the last `days` days (UTC, today included), oldest
 * first, each source's metrics in a fixed order.
 */
export const communityHistory = (
  days: number,
): Effect.Effect<ReadonlyArray<CommunityRow>, DataSourceError, SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const { since, until } = span(yield* DateTime.now, days);
    const rows = yield* orDataSourceError(
      sql<{ day: string; source: string; metric: string; value: string }>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, source, metric, value::text AS value
        FROM community_metrics
        WHERE day >= ${since} AND day <= ${until}
        ORDER BY day, source, metric`,
    );
    return rows.map((row) => ({ ...row, value: Number(row.value) }));
  });

/** One day's gap for a source: its latest reason, how often it was tried, when. */
export interface CommunityGap {
  readonly day: string;
  readonly source: string;
  readonly reason: string;
  readonly tries: number;
  /** The first and the latest try, as `HH:MM` (UTC). */
  readonly first: string;
  readonly last: string;
}

/** The gaps of the last `days` days (UTC, today included), oldest first. */
export const communityGaps = (
  days: number,
): Effect.Effect<ReadonlyArray<CommunityGap>, DataSourceError, SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const { since, until } = span(yield* DateTime.now, days);
    // `tries` is an integer, which arrives as a number.
    return yield* orDataSourceError(
      sql<CommunityGap>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, source, reason, tries,
          to_char(first_at AT TIME ZONE 'UTC', 'HH24:MI') AS first,
          to_char(last_at AT TIME ZONE 'UTC', 'HH24:MI') AS last
        FROM community_gaps
        WHERE day >= ${since} AND day <= ${until}
        ORDER BY day, source`,
    );
  });

/**
 * The history as a table: a line per source and metric, a column per day,
 * `gap` where a day has no number for a known, temporary reason (its
 * gaps), `-` where it has none at all. Then each gap: its source, latest
 * reason and tries, and whether the source answered later that day.
 */
export function formatHistory(
  rows: ReadonlyArray<CommunityRow>,
  gaps: ReadonlyArray<CommunityGap> = [],
): string {
  if (rows.length === 0 && gaps.length === 0) {
    return "No community numbers stored yet.";
  }
  const days = [
    ...new Set([...rows, ...gaps].map((row) => row.day)),
  ].toSorted();
  const series = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const name = `${row.source} ${row.metric}`;
    const values = series.get(name) ?? new Map<string, number>();
    values.set(row.day, row.value);
    series.set(name, values);
  }
  const gapped = new Set(gaps.map((gap) => `${gap.day} ${gap.source}`));
  // A source with gaps and no number yet still gets its line.
  for (const gap of gaps) {
    const named = [...series.keys()].some((name) =>
      name.startsWith(`${gap.source} `),
    );
    if (!named) series.set(`${gap.source} (no number yet)`, new Map());
  }
  const order = (name: string) => sources.indexOf(name.split(" ")[0] as Source);
  const names = [...series.keys()].toSorted(
    (a, b) => order(a) - order(b) || a.localeCompare(b),
  );
  const width = Math.max(...names.map((name) => name.length));
  const cells = (values: ReadonlyArray<string>) =>
    values.map((value) => value.padStart(10)).join("");
  const table = [
    `${"".padEnd(width)}${cells(days.map((day) => day.slice(5)))}`,
    ...names.map(
      (name) =>
        `${name.padEnd(width)}${cells(
          days.map((day) => {
            const value = series.get(name)?.get(day);
            if (value !== undefined) return String(value);
            return gapped.has(`${day} ${name.split(" ")[0]}`) ? "gap" : "-";
          }),
        )}`,
    ),
  ];
  if (gaps.length === 0) return table.join("\n");
  const answered = new Set(rows.map((row) => `${row.day} ${row.source}`));
  return [
    ...table,
    "",
    `Gaps (known and temporary: read again each hour until stored, X at most once a UTC day; ${gapDays} days with no number, today included, fail the sync):`,
    ...gaps.map(
      (gap) =>
        `  ${gap.day.slice(5)} ${gap.source.padEnd(8)} ${gap.reason}: ${gap.tries} ${gap.tries === 1 ? "try" : "tries"}, ${gap.first}${gap.last === gap.first ? "" : `–${gap.last}`} UTC${answered.has(`${gap.day} ${gap.source}`) ? ", then read" : ""}`,
    ),
  ].join("\n");
}
