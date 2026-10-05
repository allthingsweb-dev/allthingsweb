import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import type { ResolvedPost } from "./sources.ts";
import { canonicalUrl, parsePostUrl } from "./urls.ts";

/**
 * Writes posts about events to `event_posts`, one row per canonical URL:
 * adding a post that is already there changes nothing, whichever event it
 * is on and whatever its status, so a post an organizer hid stays hidden.
 */

/** No event, published or draft, has this slug. */
export class PostEventNotFound extends Schema.TaggedError<PostEventNotFound>()(
  "PostEventNotFound",
  { slug: Schema.String },
) {
  override get message(): string {
    return `No event has the slug "${this.slug}"`;
  }
}

/** Whether a post was added, or was there already (on which event). */
export type AddResult =
  | { readonly _tag: "Added"; readonly id: string; readonly url: string }
  | {
      readonly _tag: "Exists";
      readonly id: string;
      readonly url: string;
      readonly eventSlug: string;
      readonly status: string;
    };

/**
 * A post's status (core/migrations/0005_event_posts.ts). A post an
 * organizer adds is approved as they add it.
 */
export type PostStatus = "approved" | "hidden" | "pending";

const Existing = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  eventSlug: Schema.String,
  status: Schema.String,
});

const Written = Schema.Struct({
  eventId: Schema.NullOr(Schema.String),
  addedId: Schema.NullOr(Schema.String),
  existing: Schema.NullOr(Existing),
});

export interface EventPostWriterShape {
  /** Whether an event, published or draft, has `slug`. */
  readonly hasEvent: (slug: string) => Effect.Effect<boolean, DataSourceError>;
  /**
   * The stored post `url` names, if its canonical URL is known without
   * asking the platform (X, LinkedIn, and Bluesky by DID). Saves a lookup
   * for a post that is already there.
   */
  readonly find: (
    url: string,
  ) => Effect.Effect<AddResult | null, DataSourceError>;
  /** Adds `post` to the event with `slug`, in one statement. */
  readonly add: (
    slug: string,
    post: ResolvedPost,
    status?: PostStatus,
  ) => Effect.Effect<AddResult, PostEventNotFound | DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  const existingByUrl = (url: string) =>
    sql`
      SELECT json_build_object('id', p.id, 'url', p.url, 'eventSlug', e.slug,
        'status', p.status)
      FROM event_posts p JOIN events e ON e.id = p.event_id
      WHERE p.url = ${url}`;

  const find = (url: string) =>
    Effect.gen(function* () {
      const ref = parsePostUrl(url);
      // A Bluesky URL is canonical only once it names the author by DID.
      if (
        ref === null ||
        (ref.platform === "bluesky" && !ref.actor.startsWith("did:"))
      ) {
        return null;
      }
      const rows = yield* sql<{ post: unknown }>`
        SELECT (${existingByUrl(canonicalUrl(ref))}) AS post`;
      const post = rows[0]?.post ?? null;
      if (post === null) return null;
      const existing = yield* Schema.decodeUnknownEffect(Existing)(post);
      return { _tag: "Exists", ...existing } satisfies AddResult;
    }).pipe(orDataSourceError);

  const add = (
    slug: string,
    post: ResolvedPost,
    status: PostStatus = "approved",
  ) =>
    Effect.gen(function* () {
      const [row] = yield* sql`
        WITH event AS (
          SELECT id FROM events WHERE slug = ${slug}
        ), existing AS (
          ${existingByUrl(post.url)}
        ), added AS (
          INSERT INTO event_posts (event_id, platform, url, author_name,
            author_handle, author_url, author_avatar_source_url, posted_at,
            text, image_source_url, status, updated_at)
          SELECT event.id, ${post.platform}, ${post.url}, ${post.authorName},
            ${post.authorHandle}, ${post.authorUrl}, ${post.authorAvatarSourceUrl},
            ${DateTime.formatIso(post.postedAt)}::timestamptz, ${post.text},
            ${post.imageSourceUrl}, ${status}, now()
          FROM event
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          ON CONFLICT (url) DO NOTHING
          RETURNING id
        )
        SELECT (SELECT id FROM event) AS "eventId",
          (SELECT id FROM added) AS "addedId",
          (SELECT * FROM existing) AS existing`;
      const written = yield* Schema.decodeUnknownEffect(Written)(row);
      if (written.existing !== null) {
        return { _tag: "Exists", ...written.existing } satisfies AddResult;
      }
      if (written.eventId === null) {
        return yield* new PostEventNotFound({ slug });
      }
      if (written.addedId === null) {
        // Another writer added the same post between this statement's
        // snapshot and its insert.
        return yield* Effect.die(new Error(`${post.url} was added meanwhile`));
      }
      return {
        _tag: "Added",
        id: written.addedId,
        url: post.url,
      } satisfies AddResult;
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        orDataSourceError(Effect.fail(cause)),
      ),
      Effect.catchTag("SchemaError", (cause) =>
        orDataSourceError(Effect.fail(cause)),
      ),
    );

  const hasEvent = (slug: string) =>
    sql`SELECT 1 FROM events WHERE slug = ${slug}`.pipe(
      Effect.map((rows) => rows.length > 0),
      orDataSourceError,
    );

  return EventPostWriter.of({ hasEvent, find, add });
});

export class EventPostWriter extends Context.Service<
  EventPostWriter,
  EventPostWriterShape
>()("allthings/EventPostWriter") {
  static readonly layer = Layer.effect(EventPostWriter, make);
}
