import { Context, type Effect, Schema } from "effect";

/**
 * The bucket behind media.allthings.dev, as image ingestion uses it. The
 * Worker provides it with its R2 binding; the app goes through the upload
 * Worker instead (app/src/lib/media-store).
 */

/** The most bytes an image may be: what the Images binding reads to make the site's variants. */
export const maxMediaBytes = 20_000_000;

/** Storing or removing an object failed. */
export class MediaBucketError extends Schema.TaggedError<MediaBucketError>()(
  "MediaBucketError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason;
  }
}

export interface MediaBucketShape {
  /**
   * Stores `bytes` at `key` and returns their public URL. Never replaces an
   * object: one already at `key` fails it, since the site caches each photo's
   * variants for a year under URLs derived from its key.
   */
  readonly put: (
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Effect.Effect<string, MediaBucketError>;
  /** Deletes the object at `key`, if there is one. */
  readonly remove: (key: string) => Effect.Effect<void, MediaBucketError>;
}

export class MediaBucket extends Context.Service<
  MediaBucket,
  MediaBucketShape
>()("allthings/MediaBucket") {}

/** A key as it appears in a URL: each segment percent-encoded. */
export const encodeKey = (key: string): string =>
  key.split("/").map(encodeURIComponent).join("/");

/** The public URL of `key` on `origin`, as the app writes it. */
export const publicUrl = (origin: string, key: string): string =>
  `${origin.replace(/\/+$/, "")}/${encodeKey(key)}`;
