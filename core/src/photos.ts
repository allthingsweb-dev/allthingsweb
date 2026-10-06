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
 * Adding an evening's photos, and replacing one (scripts/photos.ts, and the
 * admin MCP server's `add_event_photos` and `replace_event_photo`): each
 * file is re-encoded the way the bucket keeps photos (upright, at most
 * {@link maxEdge} pixels on its long edge, JPEG, no metadata, so no
 * location), stored through the upload Worker under a key named after its
 * contents, and recorded in `images` and `event_images`.
 *
 * - **Idempotent.** A photo's key is its event and the SHA-256 of the file's
 *   bytes, so adding the same file again finds it and changes nothing. An
 *   object an interrupted run stored is reused when it serves exactly the
 *   bytes made.
 * - **Ordered.** Pages list an evening's photos by `event_images.created_at`;
 *   one run adds its photos in the order given, after those already there.
 * - **Described.** Every photo needs its own alt text, saying what is in the
 *   scene. It never names people from their faces.
 * - **Replaced in place.** A replacement takes the old photo's place in the
 *   order; the old link and its `images` row go only when nothing else
 *   points at that row. No object is ever deleted from the bucket.
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

/** Whether `a` and `b` hold the same bytes. */
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

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

/** What a run needs besides the database. */
export interface PhotoTools {
  readonly media: Media;
  readonly encode: Encoder;
  readonly placeholder: Placeholder;
  /** Where the bucket's objects are served, e.g. https://media.allthings.dev */
  readonly origin: string;
  readonly dryRun: boolean;
}

const fail = (reason: string) => Effect.fail(new PhotosError({ reason }));

const checkAlt = (file: PhotoFile) => {
  const alt = file.alt.trim();
  if (alt === "") return fail(`${file.name} has no alt text.`);
  if (alt.length > maxAltLength) {
    return fail(
      `${file.name}'s alt text is ${alt.length} characters, over ${maxAltLength}.`,
    );
  }
  return Effect.void;
};

/** The evening at `slug`: its long slug or its short link. */
const findEvent = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const events = yield* sql<{ id: string; slug: string }>`
      SELECT id::text AS id, slug FROM events
      WHERE slug = ${slug} OR short_slug = ${slug}
      ORDER BY short_slug = ${slug} DESC NULLS LAST
      LIMIT 1`;
    const event = events[0];
    if (event === undefined) return yield* fail(`No event at ${slug}.`);
    return event;
  });

/** `file` encoded for the evening `eventId`, under its content's key. */
const prepare = (
  eventId: string,
  file: PhotoFile,
  hash: string,
  { encode, placeholder, origin }: PhotoTools,
) =>
  Effect.gen(function* () {
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
    const key = photoKey(eventId, hash, encoded.format);
    return {
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
    } satisfies Prepared;
  });

/**
 * Stores `photo` through the upload Worker, then requires the media origin
 * to serve exactly the bytes made: an object stored by an earlier run, or
 * by another encoder, may not be. Nothing here ever deletes an object.
 */
const store = (photo: Prepared, media: Media) =>
  Effect.gen(function* () {
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
    const served = yield* Effect.tryPromise({
      try: () => media.get(photo.url),
      catch: (cause) =>
        new PhotosError({
          reason: `${photo.key} could not be checked: ${String(cause)}`,
        }),
    });
    if (!sameBytes(served, photo.encoded.bytes)) {
      yield* fail(
        `${photo.key} serves ${served.byteLength} bytes that are not the ${photo.encoded.bytes.byteLength} made from ${photo.file.name}.`,
      );
    }
  });

const describe = <S extends string>(photo: Prepared, status: S) => ({
  file: photo.file.name,
  key: photo.key,
  url: photo.url,
  width: photo.encoded.width,
  height: photo.encoded.height,
  bytes: photo.encoded.bytes.byteLength,
  alt: photo.file.alt.trim(),
  status,
});

/** Records `photo` in `images`, or finds the row an earlier run wrote; its id. */
const imageRow = (photo: Prepared, existingId: string | undefined) =>
  Effect.gen(function* () {
    if (existingId !== undefined) return existingId;
    const sql = yield* SqlClient;
    const rows = yield* sql<{ id: string }>`
      INSERT INTO images (url, alt, placeholder, width, height, created_at, updated_at)
      VALUES (${photo.url}, ${photo.file.alt.trim()}, ${photo.placeholder},
        ${photo.encoded.width}, ${photo.encoded.height}, now(), now())
      RETURNING id::text AS id`;
    return rows[0]!.id;
  });

/**
 * Adds `files` to the evening at `slug` (its long slug or its short link),
 * in order, or rehearses it when `dryRun`.
 */
export const addPhotos = (
  slug: string,
  files: ReadonlyArray<PhotoFile>,
  tools: PhotoTools,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    if (files.length === 0) return yield* fail("No photos given.");
    for (const file of files) yield* checkAlt(file);
    const event = yield* findEvent(slug);

    const prepared: Array<Prepared> = [];
    const seen = new Map<string, string>();
    for (const file of files) {
      const hash = yield* Effect.promise(() => contentHash(file.bytes));
      const twin = seen.get(hash);
      if (twin !== undefined) {
        return yield* fail(`${file.name} is the same file as ${twin}.`);
      }
      seen.set(hash, file.name);
      prepared.push(yield* prepare(event.id, file, hash, tools));
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

    if (!tools.dryRun) {
      for (const photo of prepared) {
        if (known.get(photo.url)?.linked === true) continue;
        yield* store(photo, tools.media);
      }
    }

    const work = Effect.gen(function* () {
      const results: Array<PhotoResult> = [];
      for (const [position, photo] of prepared.entries()) {
        const row = known.get(photo.url);
        if (row?.linked === true) {
          results.push(describe(photo, "already there"));
          continue;
        }
        const imageId = yield* imageRow(photo, row?.id);
        // One transaction has one now(); a millisecond apiece keeps the order given.
        yield* sql`
          INSERT INTO event_images (event_id, image_id, created_at, updated_at)
          VALUES (${event.id}::uuid, ${imageId}::uuid,
            now() + ${position} * interval '1 millisecond', now())`;
        results.push(describe(photo, tools.dryRun ? "would add" : "added"));
      }
      if (tools.dryRun) return yield* new RolledBack({ results });
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

/**
 * Every column that may point at an `images` row, as the schema's foreign
 * keys say (tests/photos.test.ts holds this list to the catalog): a photo's
 * row is deleted only when its evening's link is the one thing pointing at
 * it.
 */
export const imageReferences = [
  { table: "event_images", column: "image_id" },
  { table: "event_posts", column: "author_avatar" },
  { table: "event_posts", column: "image" },
  { table: "events", column: "preview_image" },
  { table: "profiles", column: "image" },
  { table: "sponsors", column: "square_logo_dark" },
  { table: "sponsors", column: "square_logo_light" },
] as const;

/** Which of the evening's photos to replace: its image id, or its place (from 1). */
export type PhotoTarget =
  | { readonly _tag: "ImageId"; readonly id: string }
  | { readonly _tag: "Position"; readonly position: number };

/** A photo replaced in its place on the evening (or, in a dry run, that would be). */
export interface Replaced {
  /** The photo that was there; its object stays in the bucket. */
  readonly old: {
    readonly imageId: string;
    readonly url: string;
    readonly position: number;
  };
  readonly new: Omit<PhotoResult, "status"> & {
    readonly status: "replaced" | "would replace";
  };
}

/**
 * Fails unless the evening's link is the one thing pointing at the image
 * `old`: its row may only be deleted then.
 */
const onlyLinked = (old: { readonly id: string; readonly url: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    for (const { table, column } of imageReferences) {
      const counted = yield* sql<{ count: number }>`
        SELECT count(*)::int AS count FROM ${sql(table)}
        WHERE ${sql(column)} = ${old.id}::uuid`;
      const allowed = table === "event_images" ? 1 : 0;
      if (counted[0]!.count !== allowed) {
        yield* fail(
          `${old.url} is also used by ${table}.${column}; its row stays, and nothing was replaced.`,
        );
      }
    }
  });

class ReplaceRolledBack extends Data.TaggedError("ReplaceRolledBack")<{
  readonly replaced: Replaced;
}> {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "3" is the third photo; a UUID is an image's id; anything else is refused. */
export const parseTarget = (text: string): PhotoTarget | undefined => {
  if (/^[1-9][0-9]*$/.test(text)) {
    return { _tag: "Position", position: Number(text) };
  }
  if (uuid.test(text)) return { _tag: "ImageId", id: text.toLowerCase() };
  return undefined;
};

/**
 * Replaces one of the evening's photos with `file`, in its place: the new
 * photo is stored and recorded as `addPhotos` records one, takes the old
 * link's `created_at`, and the old link and its `images` row are deleted,
 * all in one transaction that first checks nothing else points at the old
 * row. The old object stays in the bucket: nothing here deletes one.
 */
export const replacePhoto = (
  slug: string,
  target: PhotoTarget,
  file: PhotoFile,
  tools: PhotoTools,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* checkAlt(file);
    const event = yield* findEvent(slug);

    const photos = yield* sql<{ id: string; url: string }>`
      SELECT img.id::text AS id, img.url FROM event_images ei
      JOIN images img ON img.id = ei.image_id
      WHERE ei.event_id = ${event.id}::uuid
      ORDER BY ei.created_at, img.id`;
    const index =
      target._tag === "Position"
        ? target.position - 1
        : photos.findIndex((photo) => photo.id === target.id);
    const old = photos[index];
    if (old === undefined) {
      return yield* fail(
        target._tag === "Position"
          ? `${event.slug} has ${photos.length} photos, no photo ${target.position}.`
          : `Image ${target.id} is not one of ${event.slug}'s photos.`,
      );
    }

    const hash = yield* Effect.promise(() => contentHash(file.bytes));
    const photo = yield* prepare(event.id, file, hash, tools);
    if (photo.url === old.url) {
      return yield* fail(`${file.name} is already photo ${index + 1}.`);
    }
    const twin = photos.findIndex((other) => other.url === photo.url);
    if (twin !== -1) {
      return yield* fail(
        `${file.name} is already on ${event.slug}, as photo ${twin + 1}.`,
      );
    }
    const existing = yield* sql<{ id: string }>`
      SELECT id::text AS id FROM images WHERE url = ${photo.url}`;

    // Before anything is stored, so a refusal leaves no object behind.
    yield* onlyLinked(old);
    if (!tools.dryRun) yield* store(photo, tools.media);

    const work = Effect.gen(function* () {
      // The old link, locked, as it is now: it may have moved or gone since.
      const links = yield* sql<{ createdAt: Date }>`
        SELECT created_at AS "createdAt" FROM event_images
        WHERE event_id = ${event.id}::uuid AND image_id = ${old.id}::uuid
        FOR UPDATE`;
      const link = links[0];
      if (link === undefined) {
        return yield* fail(`${old.url} left ${event.slug} meanwhile.`);
      }
      // Again, under the lock: something may have started using it since.
      yield* onlyLinked(old);
      const imageId = yield* imageRow(photo, existing[0]?.id);
      yield* sql`
        INSERT INTO event_images (event_id, image_id, created_at, updated_at)
        VALUES (${event.id}::uuid, ${imageId}::uuid, ${link.createdAt}, now())`;
      yield* sql`
        DELETE FROM event_images
        WHERE event_id = ${event.id}::uuid AND image_id = ${old.id}::uuid`;
      yield* sql`DELETE FROM images WHERE id = ${old.id}::uuid`;
      const replaced: Replaced = {
        old: { imageId: old.id, url: old.url, position: index + 1 },
        new: describe(photo, tools.dryRun ? "would replace" : "replaced"),
      };
      if (tools.dryRun) return yield* new ReplaceRolledBack({ replaced });
      return replaced;
    });

    return yield* sql
      .withTransaction(work)
      .pipe(
        Effect.catchTag("ReplaceRolledBack", (rolledBack) =>
          Effect.succeed(rolledBack.replaced),
        ),
      );
  });
