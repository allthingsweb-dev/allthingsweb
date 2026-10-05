import { Data, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/**
 * Re-encoding oversized originals (scripts/reencode-originals.ts). The site
 * makes each photo's variants with Cloudflare's Images binding, which reads
 * at most 20 MB, and the bucket holds camera photos uploaded as PNGs of 20
 * to 40 MB. Each image on the media origin larger than the threshold is
 * fetched, re-encoded once (JPEG, or WebP where it is see-through, at most
 * {@link maxEdge} pixels on its long edge), stored under a new key, and its
 * `images` row pointed there with its new size and a new `updated_at`, so the
 * variants' URLs (which name it) change too.
 *
 * Originals are never deleted or overwritten: the new object has a key of
 * its own, and the old one stays in the bucket. Running it again is safe. A
 * row already pointing at a small image is not a candidate, and an object
 * an interrupted run already stored is reused when it is the same size.
 * A dry run fetches and encodes everything and reports, but stores and
 * writes nothing.
 */

/** Photos are never stored larger than this on their long edge. */
export const maxEdge = 4096;

/**
 * The most bytes Cloudflare's Images binding reads (its `.input()` limit):
 * an original larger than this gets no variants at all.
 */
export const imagesInputLimit = 20_000_000;

/** An image row on the media origin, with the size of its object. */
export interface Candidate {
  readonly id: string;
  readonly url: string;
  /** The object's key on the media origin, decoded. */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/** What an encoder made of an original. */
export interface Encoded {
  readonly bytes: Uint8Array;
  readonly format: "jpeg" | "webp";
  readonly width: number;
  readonly height: number;
}

/** How the run reaches the media origin and the bucket behind it. */
export interface Media {
  /** The object's size in bytes, or undefined when there is none. */
  readonly size: (url: string) => Promise<number | undefined>;
  readonly get: (url: string) => Promise<Uint8Array>;
  /**
   * Stores `bytes` under `key`, which must not exist yet: "exists" when an
   * object is already there (the bucket never replaces one).
   */
  readonly put: (
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Promise<"created" | "exists">;
}

/** Re-encodes an original, at most `edge` pixels on its long edge. */
export type Encoder = (bytes: Uint8Array, edge: number) => Promise<Encoded>;

/** One image re-encoded (or, in a dry run, that would be). */
export interface Reencoded {
  readonly id: string;
  readonly oldKey: string;
  readonly newKey: string;
  readonly oldBytes: number;
  readonly newBytes: number;
  readonly oldSize: string;
  readonly newSize: string;
  /** "stored" when this run stored it, "reused" when an earlier run had. */
  readonly object: "stored" | "reused" | "dry run";
}

export class ReencodeError extends Data.TaggedError("ReencodeError")<{
  readonly key: string;
  readonly reason: string;
}> {}

/** The key segment rules the app and the upload Worker share. */
const segment = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}._-]*$/u;

/**
 * The new key for `key` re-encoded as `format`: beside it, named after it.
 * "events/e1/a.png" becomes "events/e1/a-reencoded.jpg".
 */
export function reencodedKey(key: string, format: Encoded["format"]): string {
  const stem = key.replace(/\.[^./]+$/, "");
  return `${stem}-reencoded.${format === "jpeg" ? "jpg" : "webp"}`;
}

/** The key behind a URL on `origin`, decoded, or undefined for any other URL. */
export function keyOf(url: string, origin: string): string | undefined {
  if (!url.startsWith(`${origin}/`)) return undefined;
  try {
    const key = url
      .slice(origin.length + 1)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    return key
      .split("/")
      .every((part) => segment.test(part) && !part.includes(".."))
      ? key
      : undefined;
  } catch {
    return undefined;
  }
}

/** A key as a URL path, each segment percent-encoded as the app writes it. */
export const encodeKey = (key: string): string =>
  key.split("/").map(encodeURIComponent).join("/");

/** Runs `work` on every item, `limit` at a time, in order. */
async function mapLimit<A, B>(
  items: ReadonlyArray<A>,
  limit: number,
  work: (item: A) => Promise<B>,
): Promise<Array<B>> {
  const results: Array<B> = [];
  for (let start = 0; start < items.length; start += limit) {
    results.push(
      ...(await Promise.all(items.slice(start, start + limit).map(work))),
    );
  }
  return results;
}

/**
 * The image rows on `origin` whose objects are larger than `threshold`
 * bytes, largest first. Each object's size is asked of the media origin.
 */
export const findOversized = (
  media: Media,
  origin: string,
  threshold: number,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<{
      id: string;
      url: string;
      width: number;
      height: number;
    }>`
      SELECT id, url, width, height FROM images
      WHERE starts_with(url, ${`${origin}/`})
      ORDER BY id`;
    const sized = yield* Effect.tryPromise({
      try: () =>
        mapLimit(rows, 8, async (row) => ({
          row,
          bytes: await media.size(row.url),
        })),
      catch: (cause) =>
        new ReencodeError({ key: "(sizes)", reason: String(cause) }),
    });
    return sized
      .flatMap(({ row, bytes }): Array<Candidate> => {
        const key = keyOf(row.url, origin);
        if (key === undefined || bytes === undefined || bytes <= threshold) {
          return [];
        }
        return [{ ...row, key, bytes }];
      })
      .toSorted((a, b) => b.bytes - a.bytes);
  });

const size = (width: number, height: number) => `${width}×${height}`;

/**
 * Re-encodes `candidate` and points its row at the new object, unless
 * `dryRun`. The row is only changed while it still points at the original,
 * so a row someone changed meanwhile is left alone.
 */
export const reencode = (
  candidate: Candidate,
  {
    media,
    encode,
    origin,
    dryRun,
  }: {
    readonly media: Media;
    readonly encode: Encoder;
    readonly origin: string;
    readonly dryRun: boolean;
  },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) =>
      new ReencodeError({ key: candidate.key, reason });
    const original = yield* Effect.tryPromise({
      try: () => media.get(candidate.url),
      catch: (cause) => fail(`could not be fetched: ${String(cause)}`),
    });
    const encoded = yield* Effect.tryPromise({
      try: () => encode(original, maxEdge),
      catch: (cause) => fail(`could not be re-encoded: ${String(cause)}`),
    });
    if (encoded.bytes.byteLength > imagesInputLimit) {
      return yield* fail(
        `is still ${encoded.bytes.byteLength} bytes re-encoded, over the ${imagesInputLimit} the Images binding reads`,
      );
    }
    const newKey = reencodedKey(candidate.key, encoded.format);
    const record = {
      id: candidate.id,
      oldKey: candidate.key,
      newKey,
      oldBytes: candidate.bytes,
      newBytes: encoded.bytes.byteLength,
      oldSize: size(candidate.width, candidate.height),
      newSize: size(encoded.width, encoded.height),
    };
    if (dryRun) return { ...record, object: "dry run" } satisfies Reencoded;

    const newUrl = `${origin}/${encodeKey(newKey)}`;
    const stored = yield* Effect.tryPromise({
      try: () => media.put(newKey, encoded.bytes, `image/${encoded.format}`),
      catch: (cause) => fail(`could not be stored: ${String(cause)}`),
    });
    // What the media origin serves under the new key must be what was made:
    // an object an earlier run stored is reused only when it is.
    const served = yield* Effect.tryPromise({
      try: () => media.size(newUrl),
      catch: (cause) => fail(`could not be checked: ${String(cause)}`),
    });
    if (served !== encoded.bytes.byteLength) {
      return yield* fail(
        `${newKey} serves ${served ?? "nothing"}, not the ${encoded.bytes.byteLength} bytes made`,
      );
    }
    const updated = yield* sql<{ id: string }>`
      UPDATE images
      SET url = ${newUrl}, width = ${encoded.width}, height = ${encoded.height},
        updated_at = now()
      WHERE id = ${candidate.id}::uuid AND url = ${candidate.url}
      RETURNING id`;
    if (updated.length === 0) {
      return yield* fail("its row changed while it was being re-encoded");
    }
    return {
      ...record,
      object: stored === "created" ? "stored" : "reused",
    } satisfies Reencoded;
  });
