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
  githubRepo: "allthingsweb-dev/allthingsweb",
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

/** A source could not be read; it is tried again on a later run. */
export class CommunityReadError extends Schema.TaggedError<CommunityReadError>()(
  "CommunityReadError",
  { source: Schema.String, reason: Schema.String },
) {}

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
   * `SqlClient` and X_BEARER_TOKEN.
   */
  static readonly live = Layer.effect(
    CommunitySources,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const sql = yield* SqlClient;
      // Without it, X alone fails; a dry run never reads X.
      const xToken = yield* Config.option(Config.Redacted("X_BEARER_TOKEN"));
      const get = (
        source: Source,
        request: HttpClientRequest.HttpClientRequest,
      ) =>
        Effect.gen(function* () {
          const response = yield* client.execute(
            request.pipe(
              HttpClientRequest.setHeader("user-agent", "allthings.dev"),
            ),
          );
          if (response.status !== 200) {
            return yield* new CommunityReadError({
              source,
              reason: `answered ${response.status}`,
            });
          }
          return response;
        }).pipe(
          Effect.timeout(Duration.seconds(15)),
          Effect.catchTags({
            HttpClientError: () =>
              Effect.fail(
                new CommunityReadError({ source, reason: "no answer" }),
              ),
            TimeoutError: () =>
              Effect.fail(
                new CommunityReadError({ source, reason: "no answer in 15 s" }),
              ),
          }),
        );
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
              : new CommunityReadError({
                  source,
                  reason: "the answer is not what it should be",
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
                new CommunityReadError({ source, reason: "no answer in 35 s" }),
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
  /** Sources read and stored now. */
  readonly stored: ReadonlyArray<Source>;
  /** Sources the day already had. */
  readonly kept: ReadonlyArray<Source>;
  /** Sources not read now, and why. */
  readonly skipped: Readonly<Partial<Record<Source, string>>>;
  /** Sources that failed, and why: tried again on the next run. */
  readonly failed: Readonly<Partial<Record<Source, string>>>;
}

/** The UTC day of `now`, as `YYYY-MM-DD`. */
const dayOf = (now: DateTime.Utc) => DateTime.formatIsoDateUtc(now);

/**
 * Takes today's snapshot (UTC): reads every source the day has no row
 * for yet and stores what it reads, one row per metric. X only in the
 * day's first hour. A source that fails is left for the next run; the
 * snapshot fails only when the database does. A dry run reads the same
 * sources but X and reports what it would store (`wouldStore`), writing
 * nothing.
 */
export const snapshotCommunity = ({
  dryRun = false,
}: { readonly dryRun?: boolean } = {}) =>
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
    const wouldStore: Partial<Record<Source, Metrics>> = {};
    const skipped: Partial<Record<Source, string>> = {};
    const failed: Partial<Record<Source, string>> = {};
    for (const source of sources) {
      if (kept.has(source)) continue;
      if (source === "x" && dryRun) {
        // The plan says whether this hour's run would read and store X.
        skipped.x =
          DateTime.getPartUtc(now, "hour") === 0
            ? "a dry run never reads X, which bills each read; this hour's run would read and store it"
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
        failed[source] = read.failure.reason;
        continue;
      }
      const rows = Object.entries(read.success).map(([metric, value]) => ({
        day,
        source,
        metric,
        value,
      }));
      if (rows.length === 0) continue;
      if (dryRun) {
        wouldStore[source] = read.success;
        continue;
      }
      // The day's first value stays: a second writer never replaces it.
      yield* orDataSourceError(
        sql`INSERT INTO community_metrics ${sql.insert(rows)}
          ON CONFLICT (day, source, metric) DO NOTHING`,
      );
      stored.push(source);
    }
    return {
      day,
      stored,
      ...(dryRun ? { wouldStore } : {}),
      kept: sources.filter((source) => kept.has(source)),
      skipped,
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

/**
 * The snapshots of the last `days` days (UTC, today included), oldest
 * first, each source's metrics in a fixed order.
 */
export const communityHistory = (
  days: number,
): Effect.Effect<ReadonlyArray<CommunityRow>, DataSourceError, SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const now = yield* DateTime.now;
    const until = dayOf(now);
    const since = dayOf(
      DateTime.subtract(now, { days: Math.max(0, days - 1) }),
    );
    const rows = yield* orDataSourceError(
      sql<{ day: string; source: string; metric: string; value: string }>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, source, metric, value::text AS value
        FROM community_metrics
        WHERE day >= ${since} AND day <= ${until}
        ORDER BY day, source, metric`,
    );
    return rows.map((row) => ({ ...row, value: Number(row.value) }));
  });

/**
 * The history as a table: a line per source and metric, a column per day,
 * `-` where a day has no number.
 */
export function formatHistory(rows: ReadonlyArray<CommunityRow>): string {
  if (rows.length === 0) return "No community numbers stored yet.";
  const days = [...new Set(rows.map((row) => row.day))].toSorted();
  const series = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const name = `${row.source} ${row.metric}`;
    const values = series.get(name) ?? new Map<string, number>();
    values.set(row.day, row.value);
    series.set(name, values);
  }
  const order = (name: string) => sources.indexOf(name.split(" ")[0] as Source);
  const names = [...series.keys()].toSorted(
    (a, b) => order(a) - order(b) || a.localeCompare(b),
  );
  const width = Math.max(...names.map((name) => name.length));
  const cells = (values: ReadonlyArray<string>) =>
    values.map((value) => value.padStart(10)).join("");
  return [
    `${"".padEnd(width)}${cells(days.map((day) => day.slice(5)))}`,
    ...names.map(
      (name) =>
        `${name.padEnd(width)}${cells(
          days.map((day) => {
            const value = series.get(name)?.get(day);
            return value === undefined ? "-" : String(value);
          }),
        )}`,
    ),
  ].join("\n");
}
