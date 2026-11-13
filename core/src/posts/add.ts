import { Effect, Schema } from "effect";
import type { DataSourceError } from "../errors.ts";
import {
  type ManualPost,
  type PostSourceError,
  PostSources,
  type ResolvedPost,
} from "./sources.ts";
import {
  type AddResult,
  EventPostWriter,
  PostEventNotFound,
  type PostStatus,
} from "./store.ts";
import { canonicalUrl, parsePostUrl } from "./urls.ts";

/**
 * Adds the post at `url` to the event with `slug`: the one path the CLI
 * and backfills share. A post already stored is reported
 * as it is, without asking its platform when its URL alone says which post
 * it is. A dry run reads the post and writes nothing.
 *
 * An organizer's post is approved as it is added. Anything that finds posts
 * on its own, such as a search of X once a key exists, adds them with
 * `status: "pending"`: they wait for an organizer, and pages never show
 * them until one approves.
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
  options: {
    readonly manual?: ManualPost;
    readonly dryRun?: boolean;
    readonly status?: PostStatus;
  } = {},
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
    return yield* writer.add(slug, post, options.status ?? "approved");
  });

/**
 * The post URLs in `text`, such as a file a browser search's results were
 * copied into: every X, Bluesky or LinkedIn post URL anywhere in it, each
 * post once (as first written), in order. A line starting with `#` is a
 * note. Any other URL is returned in `ignored`, so none is dropped unseen.
 */
export function postUrlsIn(text: string): {
  readonly urls: ReadonlyArray<string>;
  readonly ignored: ReadonlyArray<string>;
} {
  const urls: Array<string> = [];
  const ignored: Array<string> = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    for (const [match] of line.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
      // A URL ends before punctuation that closes the sentence around it.
      const url = match.replace(/[),.;:!?\]]+$/, "");
      const ref = parsePostUrl(url);
      if (ref === null) {
        ignored.push(url);
        continue;
      }
      // A Bluesky URL by handle is one post by its handle and record key.
      const key =
        ref.platform === "bluesky"
          ? `bluesky:${ref.actor}/${ref.rkey}`
          : canonicalUrl(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
    }
  }
  return { urls, ignored };
}

/** What adding one URL of a batch did, or why it couldn't be read. */
export type BatchResult =
  | { readonly url: string; readonly result: AddPostResult }
  | { readonly url: string; readonly failed: string };

/**
 * Adds each of `urls` to the evening with `slug`, in order, as
 * {@link addPost} does with `options`. A post that can't be read is
 * reported and the rest go on; an evening that doesn't exist fails the
 * batch before any post is read.
 */
export const addPosts = (
  slug: string,
  urls: ReadonlyArray<string>,
  options: { readonly dryRun?: boolean; readonly status?: PostStatus } = {},
): Effect.Effect<
  ReadonlyArray<BatchResult>,
  PostEventNotFound | DataSourceError,
  PostSources | EventPostWriter
> =>
  Effect.gen(function* () {
    const writer = yield* EventPostWriter;
    if (!(yield* writer.hasEvent(slug))) {
      return yield* new PostEventNotFound({ slug });
    }
    const results: Array<BatchResult> = [];
    for (const url of urls) {
      results.push(
        yield* addPost(slug, url, options).pipe(
          Effect.map((result): BatchResult => ({ url, result })),
          Effect.catchTag("PostSourceError", (error) =>
            Effect.succeed<BatchResult>({ url, failed: error.reason }),
          ),
        ),
      );
    }
    return results;
  });
