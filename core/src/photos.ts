import { Data, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import {
  type Encoded,
  type Encoder,
  encodeKey,
  imagesInputLimit,
  type Media,
  maxEdge,
} from "./reencode.ts";

/**
 * Adding an evening's photos (scripts/photos.ts, and the admin MCP server's
 * `add_event_photos`): each file is re-encoded the way the bucket keeps
 * photos (upright, at most {@link maxEdge} pixels on its long edge, JPEG, no
 * metadata, so no location), stored through the upload Worker under a key
 * named after its contents, and recorded in `images` and `event_images`.
 *
 * - **Idempotent.** A photo's key is its event and the SHA-256 of the file's
 *   bytes, so adding the same file again finds it and changes nothing. An
 *   object an interrupted run stored is reused when it serves what was made.
 * - **Ordered.** Pages list an evening's photos by `event_images.created_at`;
 *   one run adds its photos in the order given, after those already there.
 * - **Described.** Every photo needs its own alt text, saying what is in the
 *   scene. It never names people from their faces.
 * - **All or nothing in the database.** Objects are stored first, then one
 *   transaction writes every row. A dry run encodes and checks everything
 *   and rehearses that transaction, then rolls it back; it stores nothing.
 */

/** One file to add, with what its photo shows. */
export interface PhotoFile {
  /** The file's name, for reports. */
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly alt: string;
}

/** A tiny preview of an image as a data URL, for `images.placeholder`. */
export type Placeholder = (bytes: Uint8Array) => Promise<string>;

/** What became of one file. */
export interface PhotoResult {
  readonly file: string;
  readonly key: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly alt: string;
  /**
   * "added" by this run, "already there" on the evening from an earlier
   * one, "would add" in a dry run.
   */
  readonly status: "added" | "already there" | "would add";
}

export class PhotosError extends Data.TaggedError("PhotosError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

/** Rolls the rehearsal's transaction back, carrying its results out. */
class RolledBack extends Data.TaggedError("RolledBack")<{
  readonly results: ReadonlyArray<PhotoResult>;
}> {}

/** The SHA-256 of `bytes`, as 64 lowercase hex digits. */
export const contentHash = async (bytes: Uint8Array): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

/** Where a photo of `eventId` is kept: "events/<event id>/<hash>.jpg". */
export const photoKey = (
  eventId: string,
  hash: string,
  format: Encoded["format"],
): string => `events/${eventId}/${hash}.${format === "jpeg" ? "jpg" : "webp"}`;

const contentType = (format: Encoded["format"]) => `image/${format}`;

/** The longest alt text a photo takes: a sentence or two, not a caption essay. */
export const maxAltLength = 300;

/** A file encoded, keyed and checked, ready to store. */
interface Prepared {
  readonly file: PhotoFile;
  readonly key: string;
  readonly url: string;
  readonly encoded: Encoded;
  readonly placeholder: string;
}

/**
 * Adds `files` to the evening at `slug` (its long slug or its short link),
 * in order, or rehearses it when `dryRun`.
 */
export const addPhotos = (
  slug: string,
  files: ReadonlyArray<PhotoFile>,
  {
    media,
    encode,
    placeholder,
    origin,
    dryRun,
  }: {
    readonly media: Media;
    readonly encode: Encoder;
    readonly placeholder: Placeholder;
    /** Where the bucket's objects are served, e.g. https://media.allthings.dev */
    readonly origin: string;
    readonly dryRun: boolean;
  },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) => Effect.fail(new PhotosError({ reason }));

    if (files.length === 0) return yield* fail("No photos given.");
    for (const file of files) {
      const alt = file.alt.trim();
      if (alt === "") return yield* fail(`${file.name} has no alt text.`);
      if (alt.length > maxAltLength) {
        return yield* fail(
          `${file.name}'s alt text is ${alt.length} characters, over ${maxAltLength}.`,
        );
      }
    }

    const events = yield* sql<{ id: string; slug: string }>`
      SELECT id::text AS id, slug FROM events
      WHERE slug = ${slug} OR short_slug = ${slug}
      ORDER BY short_slug = ${slug} DESC NULLS LAST
      LIMIT 1`;
    const event = events[0];
    if (event === undefined) return yield* fail(`No event at ${slug}.`);

    const prepared: Array<Prepared> = [];
    const seen = new Map<string, string>();
    for (const file of files) {
      const hash = yield* Effect.promise(() => contentHash(file.bytes));
      const twin = seen.get(hash);
      if (twin !== undefined) {
        return yield* fail(`${file.name} is the same file as ${twin}.`);
      }
      seen.set(hash, file.name);
      const encoded = yield* Effect.tryPromise({
        try: () => encode(file.bytes, maxEdge),
        catch: (cause) =>
          new PhotosError({
            reason: `${file.name} could not be encoded: ${String(cause)}`,
          }),
      });
      if (encoded.bytes.byteLength > imagesInputLimit) {
        return yield* fail(
          `${file.name} is ${encoded.bytes.byteLength} bytes encoded, over the ${imagesInputLimit} the Images binding reads.`,
        );
      }
      const key = photoKey(event.id, hash, encoded.format);
      prepared.push({
        file,
        key,
        url: `${origin}/${encodeKey(key)}`,
        encoded,
        placeholder: yield* Effect.tryPromise({
          try: () => placeholder(encoded.bytes),
          catch: (cause) =>
            new PhotosError({
              reason: `${file.name}'s placeholder could not be made: ${String(cause)}`,
            }),
        }),
      });
    }

    const existing = yield* sql<{ url: string; id: string; linked: boolean }>`
      SELECT img.url, img.id::text AS id,
        EXISTS (
          SELECT 1 FROM event_images ei
          WHERE ei.event_id = ${event.id}::uuid AND ei.image_id = img.id
        ) AS linked
      FROM images img
      WHERE img.url IN ${sql.in(prepared.map((photo) => photo.url))}`;
    const known = new Map(existing.map((row) => [row.url, row]));
    const result = (
      photo: Prepared,
      status: PhotoResult["status"],
    ): PhotoResult => ({
      file: photo.file.name,
      key: photo.key,
      url: photo.url,
      width: photo.encoded.width,
      height: photo.encoded.height,
      bytes: photo.encoded.bytes.byteLength,
      alt: photo.file.alt.trim(),
      status,
    });

    if (!dryRun) {
      for (const photo of prepared) {
        if (known.get(photo.url)?.linked === true) continue;
        yield* Effect.tryPromise({
          try: () =>
            media.put(
              photo.key,
              photo.encoded.bytes,
              contentType(photo.encoded.format),
            ),
          catch: (cause) =>
            new PhotosError({
              reason: `${photo.file.name} could not be stored: ${String(cause)}`,
            }),
        });
        // What the origin serves under the key must be what was made: an
        // object stored by an earlier run, or another encoder, may not be.
        const served = yield* Effect.tryPromise({
          try: () => media.size(photo.url),
          catch: (cause) =>
            new PhotosError({
              reason: `${photo.key} could not be checked: ${String(cause)}`,
            }),
        });
        if (served !== photo.encoded.bytes.byteLength) {
          return yield* fail(
            `${photo.key} serves ${served ?? "nothing"} bytes, not the ${photo.encoded.bytes.byteLength} made from ${photo.file.name}.`,
          );
        }
      }
    }

    const work = Effect.gen(function* () {
      const results: Array<PhotoResult> = [];
      for (const [position, photo] of prepared.entries()) {
        const row = known.get(photo.url);
        if (row?.linked === true) {
          results.push(result(photo, "already there"));
          continue;
        }
        const imageId =
          row?.id ??
          (yield* sql<{ id: string }>`
            INSERT INTO images (url, alt, placeholder, width, height, created_at, updated_at)
            VALUES (${photo.url}, ${photo.file.alt.trim()}, ${photo.placeholder},
              ${photo.encoded.width}, ${photo.encoded.height}, now(), now())
            RETURNING id::text AS id`)[0]!.id;
        // One transaction has one now(); a millisecond apiece keeps the order given.
        yield* sql`
          INSERT INTO event_images (event_id, image_id, created_at, updated_at)
          VALUES (${event.id}::uuid, ${imageId}::uuid,
            now() + ${position} * interval '1 millisecond', now())`;
        results.push(result(photo, dryRun ? "would add" : "added"));
      }
      if (dryRun) return yield* new RolledBack({ results });
      return results;
    });

    return yield* sql
      .withTransaction(work)
      .pipe(
        Effect.catchTag("RolledBack", (rolledBack) =>
          Effect.succeed(rolledBack.results),
        ),
      );
  });
