import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { DataSourceError } from "../errors.ts";
import type { Moment } from "../promo/drafts.ts";

/**
 * The record of each evening's post sent to a channel that can't be read
 * back (migrations/0021_sent_posts.ts), so that it goes out once. A row
 * moves through:
 *
 * - `sending`: claimed (`claim`) before anything is sent. Only one claim
 *   can ever hold an evening's moment on a channel, so a second send never
 *   starts.
 * - `sent` (`markSent`): the platform took it, as this message.
 * - `unanswered` (`markUnanswered`): the send got no answer, so the
 *   message may be out.
 *
 * A claim the platform refused is dropped at once (`drop`). An unanswered
 * one, or one still `sending` after `staleAfter` (its process died), is
 * settled by an organizer who has looked at the channel: recorded as the
 * message they found there (`markSent`), or let go of (`release`) when
 * there is none. A claim whose send is still going is neither, and a sent
 * post is never released.
 *
 * The rows are in the planning schema: this runs as the database owner,
 * never as a site role.
 */

export type RecordedChannel = "discord" | "x";

/**
 * How long a send may take before its claim counts as abandoned. It must
 * outlast the longest send: each request gives up after 30 seconds
 * (src/social/discord.ts, src/social/x.ts), and `hold` renews the claim
 * just before it.
 */
export const staleAfter = Duration.minutes(5);

export interface SentPost {
  readonly id: string;
  readonly status: "sending" | "unanswered" | "sent";
  readonly token: string;
  /** The exact text approved, so a post found later can be checked against it. */
  readonly body: string | null;
  readonly messageId: string | null;
  readonly url: string | null;
  readonly claimedAt: string;
  readonly sentAt: string | null;
}

const SentPostRows = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    status: Schema.Literals(["sending", "unanswered", "sent"]),
    token: Schema.String,
    body: Schema.NullOr(Schema.String),
    messageId: Schema.NullOr(Schema.String),
    url: Schema.NullOr(Schema.String),
    claimedAt: Schema.String,
    sentAt: Schema.NullOr(Schema.String),
  }),
);

/**
 * Whether `post` waits on an organizer: unanswered, or still `sending`
 * `staleAfter` after it was claimed.
 */
export const isUnsettled = (post: SentPost, now: DateTime.Utc): boolean =>
  post.status === "unanswered" ||
  (post.status === "sending" &&
    DateTime.toEpochMillis(now) - Date.parse(post.claimedAt) >=
      Duration.toMillis(staleAfter));

export interface SentPostsShape {
  /** The evening's post for `moment` on `channel`, claimed or sent, if any. */
  readonly find: (
    channel: RecordedChannel,
    slug: string,
    moment: Moment,
  ) => Effect.Effect<Option.Option<SentPost>, DataSourceError>;
  /**
   * Claims it for `token`, the approval of exactly `body`: the claim, or
   * None when one already holds it.
   */
  readonly claim: (
    channel: RecordedChannel,
    slug: string,
    moment: Moment,
    token: string,
    body: string,
  ) => Effect.Effect<Option.Option<SentPost>, DataSourceError>;
  /** Records the claim `id`, unless already sent, as `messageId` at `url`. */
  readonly markSent: (
    id: string,
    messageId: string,
    url: string,
  ) => Effect.Effect<SentPost, DataSourceError>;
  /**
   * Renews the claim `id` just before its send: false when it was let go
   * of meanwhile, and the send must not start.
   */
  readonly hold: (id: string) => Effect.Effect<boolean, DataSourceError>;
  /** Records that the claim `id`'s send went unanswered. */
  readonly markUnanswered: (id: string) => Effect.Effect<void, DataSourceError>;
  /** Drops the claim `id` while it is sending: the platform refused it. */
  readonly drop: (id: string) => Effect.Effect<void, DataSourceError>;
  /** Lets go of the claim `id` if it is unsettled: the claim let go of, or None. */
  readonly release: (
    id: string,
  ) => Effect.Effect<Option.Option<SentPost>, DataSourceError>;
}

/** `column`, a timestamptz, as an ISO instant in UTC, whatever the session's time zone. */
const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  const columns = sql.literal(
    `s.id, s.status, s.token, s.body, s.message_id AS "messageId", s.url,
     ${iso("s.claimed_at")} AS "claimedAt", ${iso("s.sent_at")} AS "sentAt"`,
  );

  const rows = <E, R>(effect: Effect.Effect<unknown, E, R>) =>
    effect.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(SentPostRows)),
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  const first = (posts: ReadonlyArray<SentPost>) =>
    Option.fromNullishOr(posts[0]);

  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const find = (channel: RecordedChannel, slug: string, moment: Moment) =>
    rows(
      sql`SELECT ${columns} FROM planning.sent_posts s JOIN events e ON e.id = s.event_id
          WHERE s.channel = ${channel} AND e.slug = ${slug} AND s.moment = ${moment}`,
    ).pipe(Effect.map(first));

  const claim = (
    channel: RecordedChannel,
    slug: string,
    moment: Moment,
    token: string,
    body: string,
  ) =>
    Effect.flatMap(now, (claimedAt) =>
      rows(
        sql`WITH s AS (
              INSERT INTO planning.sent_posts (channel, event_id, moment, token, body, claimed_at)
              SELECT ${channel}, e.id, ${moment}, ${token}, ${body}, ${claimedAt}::timestamptz
              FROM events e WHERE e.slug = ${slug}
              ON CONFLICT (channel, event_id, moment) DO NOTHING
              RETURNING *
            )
            SELECT ${columns} FROM s`,
      ),
    ).pipe(Effect.map(first));

  const markSent = (id: string, messageId: string, url: string) =>
    Effect.flatMap(now, (sentAt) =>
      rows(
        sql`WITH s AS (
              UPDATE planning.sent_posts
              SET status = 'sent', message_id = ${messageId}, url = ${url}, sent_at = ${sentAt}::timestamptz
              WHERE id = ${id} AND status <> 'sent'
              RETURNING *
            )
            SELECT ${columns} FROM s`,
      ),
    ).pipe(
      Effect.flatMap(([row]) =>
        row === undefined
          ? Effect.die(`no claim ${id} is waiting to be marked sent`)
          : Effect.succeed(row),
      ),
    );

  const hold = (id: string) =>
    Effect.flatMap(now, (at) =>
      sql`UPDATE planning.sent_posts SET claimed_at = ${at}::timestamptz
          WHERE id = ${id} AND status = 'sending' RETURNING id`.pipe(
        Effect.map((held) => held.length === 1),
        Effect.mapError((cause) => new DataSourceError({ cause })),
      ),
    );

  const markUnanswered = (id: string) =>
    sql`UPDATE planning.sent_posts SET status = 'unanswered'
        WHERE id = ${id} AND status = 'sending'`.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  const drop = (id: string) =>
    sql`DELETE FROM planning.sent_posts WHERE id = ${id} AND status = 'sending'`.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  const release = (id: string) =>
    Effect.flatMap(DateTime.now, (at) =>
      rows(
        sql`WITH s AS (
              DELETE FROM planning.sent_posts
              WHERE id = ${id} AND (
                status = 'unanswered'
                OR (status = 'sending' AND claimed_at <= ${DateTime.formatIso(
                  DateTime.subtractDuration(at, staleAfter),
                )}::timestamptz)
              )
              RETURNING *
            )
            SELECT ${columns} FROM s`,
      ),
    ).pipe(Effect.map(first));

  return SentPosts.of({
    find,
    claim,
    markSent,
    hold,
    markUnanswered,
    drop,
    release,
  });
});

export class SentPosts extends Context.Service<SentPosts, SentPostsShape>()(
  "allthings/SentPosts",
) {
  /** Needs a `SqlClient` that may use the planning schema. */
  static readonly layer = Layer.effect(SentPosts, make);
}
