import { DateTime, Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { orDataSourceError } from "../sql.ts";
import { canonicalUrl, parsePostUrl } from "./urls.ts";

/**
 * Reviewing posts a search added (src/posts/candidates.ts): listing the
 * pending ones and approving or hiding each. Only an approved post shows on
 * its evening's page; a hidden one never does, and a later search leaves it
 * hidden.
 */

export const PendingPost = Schema.Struct({
  eventSlug: Schema.String,
  url: Schema.String,
  platform: Schema.String,
  authorName: Schema.String,
  authorHandle: Schema.NullOr(Schema.String),
  postedAt: Schema.DateTimeUtcFromDate,
  text: Schema.String,
});
export type PendingPost = typeof PendingPost.Type;

/** Pending posts, an evening's or every one, earliest first. */
export const pendingPosts = (slug?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const find = SqlSchema.findAll({
      Request: Schema.Struct({ slug: Schema.NullOr(Schema.String) }),
      Result: PendingPost,
      execute: ({ slug: only }) => sql`
        SELECT e.slug AS "eventSlug", p.url, p.platform,
          p.author_name AS "authorName", p.author_handle AS "authorHandle",
          p.posted_at AS "postedAt", p.text
        FROM event_posts p JOIN events e ON e.id = p.event_id
        WHERE p.status = 'pending' AND (${only}::text IS NULL OR e.slug = ${only})
        ORDER BY e.start_date DESC, p.posted_at, p.id`,
    });
    return yield* orDataSourceError(find({ slug: slug ?? null }));
  });

/** A post's status changed, or why it couldn't be. */
export type StatusChange =
  | {
      readonly _tag: "Changed";
      readonly url: string;
      readonly eventSlug: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly _tag: "Unchanged";
      readonly url: string;
      readonly status: string;
    }
  | { readonly _tag: "NotFound"; readonly url: string }
  /** A handle and record key that several stored posts share: none changed. */
  | {
      readonly _tag: "Ambiguous";
      readonly url: string;
      readonly matches: ReadonlyArray<string>;
    };

/**
 * The stored posts `url` names: by its canonical URL, or for a Bluesky post
 * named by handle, by its record key. Usually one; several when a handle
 * and record key match more than one stored post; none when `url` names no
 * post or no stored one.
 */
const storedPosts = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const ref = parsePostUrl(url);
    if (ref === null) return [];
    // A Bluesky post named by handle: its record key, as the URL ends.
    const keySuffix = `/post/${ref.platform === "bluesky" ? ref.rkey : ""}`;
    const byCanonical =
      ref.platform !== "bluesky" || ref.actor.startsWith("did:");
    return yield* orDataSourceError(
      sql<{ url: string; eventSlug: string; status: string }>`
        SELECT p.url, e.slug AS "eventSlug", p.status
        FROM event_posts p JOIN events e ON e.id = p.event_id
        WHERE ${
          byCanonical
            ? sql`p.url = ${canonicalUrl(ref)}`
            : // The record key compared as text, not a pattern: "_" in a key
              // must not match any character.
              sql`p.platform = 'bluesky'
                AND right(p.url, length(${keySuffix})) = ${keySuffix}
                AND p.author_handle = ${ref.platform === "bluesky" ? ref.actor : ""}`
        }
        ORDER BY p.id`,
    );
  });

/**
 * Sets the stored post `url` names to `status`: by its canonical URL, or
 * for a Bluesky post named by handle, by its record key. Where several
 * stored posts match, it changes none and names them.
 */
export const setPostStatus = (url: string, status: "approved" | "hidden") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* storedPosts(url);
    if (rows.length > 1) {
      return {
        _tag: "Ambiguous",
        url,
        matches: rows.map((match) => match.url),
      } satisfies StatusChange;
    }
    const [row] = rows;
    if (row === undefined)
      return { _tag: "NotFound", url } satisfies StatusChange;
    if (row.status === status) {
      return { _tag: "Unchanged", url: row.url, status } satisfies StatusChange;
    }
    yield* orDataSourceError(
      sql`UPDATE event_posts SET status = ${status}, updated_at = now()
        WHERE url = ${row.url}`,
    );
    return {
      _tag: "Changed",
      url: row.url,
      eventSlug: row.eventSlug,
      from: row.status,
      to: status,
    } satisfies StatusChange;
  });

/** A post moved to another evening, or why it wasn't. */
export type PostMove =
  | {
      readonly _tag: "Moved";
      readonly url: string;
      readonly from: string;
      readonly to: string;
      readonly status: string;
    }
  | {
      readonly _tag: "Unchanged";
      readonly url: string;
      readonly eventSlug: string;
    }
  | { readonly _tag: "NotFound"; readonly url: string }
  | {
      readonly _tag: "NoSuchEvening";
      readonly url: string;
      readonly slug: string;
    }
  /** A handle and record key that several stored posts share: none moved. */
  | {
      readonly _tag: "Ambiguous";
      readonly url: string;
      readonly matches: ReadonlyArray<string>;
    };

/**
 * Moves the stored post `url` names to the evening with `slug`, keeping
 * its status: for a post the finder filed under the wrong evening. Found
 * as `setPostStatus` finds it; where several stored posts match, or the
 * evening doesn't exist, it moves none.
 */
export const movePost = (url: string, slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* storedPosts(url);
    if (rows.length > 1) {
      return {
        _tag: "Ambiguous",
        url,
        matches: rows.map((match) => match.url),
      } satisfies PostMove;
    }
    const [row] = rows;
    if (row === undefined) return { _tag: "NotFound", url } satisfies PostMove;
    if (row.eventSlug === slug) {
      return {
        _tag: "Unchanged",
        url: row.url,
        eventSlug: slug,
      } satisfies PostMove;
    }
    const moved = yield* orDataSourceError(
      sql<{ id: string }>`
        UPDATE event_posts p SET event_id = e.id, updated_at = now()
        FROM events e
        WHERE e.slug = ${slug} AND p.url = ${row.url}
        RETURNING p.id`,
    );
    if (moved.length === 0) {
      return { _tag: "NoSuchEvening", url: row.url, slug } satisfies PostMove;
    }
    return {
      _tag: "Moved",
      url: row.url,
      from: row.eventSlug,
      to: slug,
      status: row.status,
    } satisfies PostMove;
  });

/** A pending post as JSON, its time in ISO 8601. */
export const pendingJson = (post: PendingPost) => ({
  ...post,
  postedAt: DateTime.formatIso(post.postedAt),
});
