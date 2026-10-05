import { Effect, Schema } from "effect";
import type { DataSourceError } from "../errors.ts";
import {
  type ManualPost,
  type PostSourceError,
  PostSources,
  type ResolvedPost,
} from "./sources.ts";
import { type AddResult, EventPostWriter, PostEventNotFound } from "./store.ts";

/**
 * Adds the post at `url` to the event with `slug`, approved: the one path
 * the CLI, the admin MCP tool and backfills share. A post already stored is
 * reported as it is, without asking its platform when its URL alone says
 * which post it is. A dry run reads the post and writes nothing.
 */

/** One post to add, as a backfill file lists it. */
export const BackfillEntry = Schema.Struct({
  slug: Schema.String,
  url: Schema.String,
  /** LinkedIn only, with `text`: nothing public serves its posts. */
  authorName: Schema.optionalKey(Schema.String),
  authorUrl: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  /** Why this post is about this event, for whoever reviews the file. */
  note: Schema.String.check(Schema.isNonEmpty()),
});

/** A backfill file: posts to add, in order. */
export const BackfillFile = Schema.Array(BackfillEntry);

export type AddPostResult =
  | AddResult
  | { readonly _tag: "WouldAdd"; readonly post: ResolvedPost };

export const addPost = (
  slug: string,
  url: string,
  options: { readonly manual?: ManualPost; readonly dryRun?: boolean } = {},
): Effect.Effect<
  AddPostResult,
  PostSourceError | PostEventNotFound | DataSourceError,
  PostSources | EventPostWriter
> =>
  Effect.gen(function* () {
    const writer = yield* EventPostWriter;
    const sources = yield* PostSources;
    if (!(yield* writer.hasEvent(slug))) {
      return yield* new PostEventNotFound({ slug });
    }
    const stored = yield* writer.find(url);
    if (stored !== null) return stored;
    const post = yield* sources.resolve(url, options.manual);
    // A Bluesky handle URL is known by its canonical URL only now.
    const resolved = yield* writer.find(post.url);
    if (resolved !== null) return resolved;
    if (options.dryRun === true) return { _tag: "WouldAdd", post } as const;
    return yield* writer.add(slug, post);
  });
