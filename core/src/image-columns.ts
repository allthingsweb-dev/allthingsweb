import { Data, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken, isApprovalToken } from "./approval.ts";
import { contentHash, imageReferences, type Placeholder } from "./photos.ts";
import {
  type Encoded,
  type Encoder,
  encodeKey,
  imagesInputLimit,
  type Media,
  maxEdge,
} from "./reencode.ts";

/**
 * Setting a row's image columns from local files, exactly as a dry run
 * showed it: a hosting company's two logos (src/host-logos.ts) and, the
 * same way, a profile's photo. Each file is encoded the way the bucket
 * keeps photos (scripts/encode.ts: upright, at most {@link maxEdge} pixels
 * on its long edge, JPEG, or WebP where it is see-through, no metadata),
 * stored through the upload Worker, recorded in `images`, and set in its
 * column.
 *
 * - **Deterministic.** An image's id is derived from its column, its row
 *   and the SHA-256 of the file, and its key from that id, so the dry run
 *   names the exact id, key and URL the approved run writes, and setting
 *   the same file again changes nothing.
 * - **Approved.** The dry run prints the change and an approval token, the
 *   hash of that change. The approved run works the change out again,
 *   refuses before storing anything unless it hashes to the token, and
 *   again in its transaction, with the row and the images it replaces
 *   locked.
 * - **Nothing deleted from the bucket.** An image a column no longer
 *   points at loses its `images` row only when nothing else points at that
 *   row (`imageReferences`); its object always stays in the bucket.
 */

/** A column that holds one image of a row. */
export type ImageColumn =
  | { readonly table: "sponsors"; readonly column: "square_logo_dark" }
  | { readonly table: "sponsors"; readonly column: "square_logo_light" }
  | { readonly table: "profiles"; readonly column: "image" };

/** A local file, read. */
export interface ImageFile {
  /** The file's name, for reports. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** What setting one column takes: the file, its alt text, its key. */
export interface ColumnRequest {
  readonly column: ImageColumn;
  readonly file: ImageFile;
  readonly alt: string;
  /** Where the image is kept, from its id and its file extension. */
  readonly key: (imageId: string, extension: "jpg" | "webp") => string;
}

/** A file encoded once, with what the change records of it. */
export interface PreparedImage {
  readonly file: string;
  /** The SHA-256 of the file as given, which names the image. */
  readonly fileSha256: string;
  readonly encoded: Encoded;
  /** The SHA-256 of the bytes stored: the token covers exactly them. */
  readonly sha256: string;
  readonly placeholder: string;
}

/** What setting one column does. */
export interface ColumnChange {
  /** "sponsors.square_logo_dark". */
  readonly column: string;
  /** What the column points at now. */
  readonly from: { readonly imageId: string; readonly url: string } | null;
  readonly to: {
    readonly imageId: string;
    readonly key: string;
    readonly url: string;
    readonly file: string;
    readonly fileSha256: string;
    readonly format: Encoded["format"];
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    readonly sha256: string;
    readonly alt: string;
    readonly placeholder: string;
  };
  /**
   * "unchanged" when the column already points at this image; "insert"
   * when its `images` row is new; "reuse" when an earlier run wrote it.
   */
  readonly image: "unchanged" | "insert" | "reuse";
  /**
   * The image the column stops pointing at: its row is deleted when
   * nothing else points at it, else kept with what still uses it. Its
   * object stays in the bucket either way.
   */
  readonly replaced:
    | null
    | { readonly imageId: string; readonly url: string; readonly row: "delete" }
    | {
        readonly imageId: string;
        readonly url: string;
        readonly row: "keep";
        readonly usedBy: ReadonlyArray<string>;
      };
}

/** Setting a row's image columns, as the database holds it now. */
export interface ImageChange {
  readonly row: {
    readonly table: ImageColumn["table"];
    readonly id: string;
    readonly name: string;
  };
  readonly columns: ReadonlyArray<ColumnChange>;
}

/** What a run needs besides the database. */
export interface ImageTools {
  readonly media: Media;
  readonly encode: Encoder;
  readonly placeholder: Placeholder;
  /** Where the bucket's objects are served, e.g. https://media.allthings.dev */
  readonly origin: string;
}

export class ImageColumnsError extends Data.TaggedError("ImageColumnsError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

const fail = (reason: string) => Effect.fail(new ImageColumnsError({ reason }));

/** A version 8 UUID made of the SHA-256 of `seed`: the same seed, the same id. */
export const derivedId = async (seed: string): Promise<string> => {
  const hex = await contentHash(new TextEncoder().encode(seed));
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
};

/** "Acme Inc." as "acme-inc", as the app names keys; `fallback` when nothing is left. */
export const keySlug = (name: string, fallback: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || fallback;

/** The extension a stored image's key ends in. */
export const extensionOf = (format: Encoded["format"]): "jpg" | "webp" =>
  format === "jpeg" ? "jpg" : "webp";

/** Encodes `file` once, as the bucket keeps photos. */
export const prepareImage = (
  file: ImageFile,
  { encode, placeholder }: Pick<ImageTools, "encode" | "placeholder">,
) =>
  Effect.gen(function* () {
    const encoded = yield* Effect.tryPromise({
      try: () => encode(file.bytes, maxEdge),
      catch: (cause) =>
        new ImageColumnsError({
          reason: `${file.name} could not be encoded: ${String(cause)}`,
        }),
    });
    if (encoded.bytes.byteLength > imagesInputLimit) {
      return yield* fail(
        `${file.name} is ${encoded.bytes.byteLength} bytes encoded, over the ${imagesInputLimit} the Images binding reads.`,
      );
    }
    const prepared: PreparedImage = {
      file: file.name,
      fileSha256: yield* Effect.promise(() => contentHash(file.bytes)),
      encoded,
      sha256: yield* Effect.promise(() => contentHash(encoded.bytes)),
      placeholder: yield* Effect.tryPromise({
        try: () => placeholder(encoded.bytes),
        catch: (cause) =>
          new ImageColumnsError({
            reason: `${file.name}'s placeholder could not be made: ${String(cause)}`,
          }),
      }),
    };
    return prepared;
  });

/** One requested column with its file encoded. */
export interface PreparedRequest {
  readonly column: ImageColumn;
  readonly image: PreparedImage;
  readonly alt: string;
  readonly key: ColumnRequest["key"];
}

/**
 * Setting `requests` on the row `row` (all in its table), as the database
 * holds it now. Under `lock`, inside a transaction, the row and the images
 * its columns point at are locked first.
 */
export const imageChange = (
  row: ImageChange["row"],
  requests: ReadonlyArray<PreparedRequest>,
  { origin, lock }: { readonly origin: string; readonly lock: boolean },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    if (requests.some((request) => request.column.table !== row.table)) {
      return yield* fail(`Every column set must be one of ${row.table}'s.`);
    }
    const rows = lock
      ? yield* sql<Record<string, unknown>>`
          SELECT * FROM ${sql(row.table)} WHERE id = ${row.id}::uuid FOR UPDATE`
      : yield* sql<Record<string, unknown>>`
          SELECT * FROM ${sql(row.table)} WHERE id = ${row.id}::uuid`;
    const now = rows[0];
    if (now === undefined) {
      return yield* fail(`${row.name} left ${row.table} meanwhile.`);
    }
    if (now["name"] !== row.name) {
      return yield* fail(
        `${row.name} is now named ${String(now["name"])}: read it again.`,
      );
    }

    const changes: Array<Omit<ColumnChange, "replaced">> = [];
    for (const request of requests) {
      const column = `${row.table}.${request.column.column}`;
      const imageId = yield* Effect.promise(() =>
        derivedId(`${column}/${row.id}/${request.image.fileSha256}`),
      );
      const key = request.key(
        imageId,
        extensionOf(request.image.encoded.format),
      );
      const url = `${origin}/${encodeKey(key)}`;
      const fromId = now[request.column.column];
      const from =
        typeof fromId === "string"
          ? {
              imageId: fromId,
              url:
                (yield* sql<{ url: string }>`
                  SELECT url FROM images WHERE id = ${fromId}::uuid`)[0]?.url ??
                "",
            }
          : null;
      const existing = (yield* sql<{ url: string }>`
        SELECT url FROM images WHERE id = ${imageId}::uuid`)[0];
      if (existing !== undefined && existing.url !== url) {
        return yield* fail(
          `Image ${imageId} is already ${existing.url}, not ${url}.`,
        );
      }
      changes.push({
        column,
        from,
        to: {
          imageId,
          key,
          url,
          file: request.image.file,
          fileSha256: request.image.fileSha256,
          format: request.image.encoded.format,
          width: request.image.encoded.width,
          height: request.image.encoded.height,
          bytes: request.image.encoded.bytes.byteLength,
          sha256: request.image.sha256,
          alt: request.alt,
          placeholder: request.image.placeholder,
        },
        image:
          from?.imageId === imageId
            ? "unchanged"
            : existing === undefined
              ? "insert"
              : "reuse",
      });
    }

    // What each image a column stops pointing at is used by once the
    // change is made: everything that points at it now, less the columns
    // of this row the change moves away from it.
    const columns: Array<ColumnChange> = [];
    for (const change of changes) {
      if (change.image === "unchanged" || change.from === null) {
        columns.push({ ...change, replaced: null });
        continue;
      }
      const { imageId, url } = change.from;
      if (lock) {
        // A new reference to the row waits for this lock, so the count holds.
        yield* sql`SELECT 1 FROM images WHERE id = ${imageId}::uuid FOR UPDATE`;
      }
      const usedBy: Array<string> = [];
      for (const { table, column } of imageReferences) {
        const counted = yield* sql<{ count: number }>`
          SELECT count(*)::int AS count FROM ${sql(table)}
          WHERE ${sql(column)} = ${imageId}::uuid`;
        const moving = changes.filter(
          (other) =>
            other.column === `${table}.${column}` &&
            other.from?.imageId === imageId &&
            other.image !== "unchanged",
        ).length;
        if (counted[0]!.count > moving) usedBy.push(`${table}.${column}`);
      }
      columns.push({
        ...change,
        replaced:
          usedBy.length === 0
            ? { imageId, url, row: "delete" }
            : { imageId, url, row: "keep", usedBy },
      });
    }
    const change: ImageChange = { row, columns };
    return change;
  });

/** A change and its approval token, from a dry run. */
export interface PlannedImageChange {
  readonly change: ImageChange;
  readonly token: string;
}

/**
 * What setting `requests` on `row` would do, and the approval token for
 * exactly that. It only reads.
 */
export const planImageChange = (
  row: ImageChange["row"],
  requests: ReadonlyArray<PreparedRequest>,
  origin: string,
) =>
  Effect.gen(function* () {
    const change = yield* imageChange(row, requests, { origin, lock: false });
    const planned: PlannedImageChange = {
      change,
      token: yield* approvalToken(change),
    };
    return planned;
  });

/**
 * Stores `bytes` under `key` through the upload Worker, then requires the
 * media origin to serve exactly those bytes: an object an earlier run
 * stored under that key is reused only then.
 */
const storeExactly = (
  stored: { readonly key: string; readonly url: string; readonly file: string },
  bytes: Uint8Array,
  format: Encoded["format"],
  media: Media,
) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => media.put(stored.key, bytes, `image/${format}`),
      catch: (cause) =>
        new ImageColumnsError({
          reason: `${stored.file} could not be stored: ${String(cause)}`,
        }),
    });
    const served = yield* Effect.tryPromise({
      try: () => media.get(stored.url),
      catch: (cause) =>
        new ImageColumnsError({
          reason: `${stored.key} could not be checked: ${String(cause)}`,
        }),
    });
    const same =
      served.byteLength === bytes.byteLength &&
      served.every((byte, index) => byte === bytes[index]);
    if (!same) {
      yield* fail(
        `${stored.key} serves ${served.byteLength} bytes that are not the ${bytes.byteLength} made from ${stored.file}.`,
      );
    }
  });

const refusal = (token: string, now: string, again: string) =>
  `The change has changed since ${token} was approved: it is now ${now}. Read it again with ${again}, and approve that.`;

/**
 * Sets `requests` on `row` exactly as the dry run that printed `token`
 * showed. The change is worked out again, and refused before anything is
 * stored unless it hashes to `token`. Each new image is stored, then one
 * transaction locks the row and the images it replaces, works the change
 * out once more, refuses it unless it still hashes to `token`, and writes
 * it: new `images` rows, the columns, and the rows of replaced images
 * nothing else uses. No object is ever deleted from the bucket. `again` is
 * the dry run's command, for the refusal.
 */
export const applyImageChange = (
  row: ImageChange["row"],
  requests: ReadonlyArray<PreparedRequest>,
  token: string,
  {
    media,
    origin,
    again,
  }: Pick<ImageTools, "media" | "origin"> & {
    readonly again: string;
  },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    if (!isApprovalToken(token)) {
      return yield* fail(
        `${token} is not an approval token: give the one ${again} printed.`,
      );
    }
    const before = yield* planImageChange(row, requests, origin);
    if (before.token !== token) {
      return yield* fail(refusal(token, before.token, again));
    }
    for (const [index, change] of before.change.columns.entries()) {
      if (change.image !== "insert") continue;
      yield* storeExactly(
        change.to,
        requests[index]!.image.encoded.bytes,
        change.to.format,
        media,
      );
    }
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const change = yield* imageChange(row, requests, {
          origin,
          lock: true,
        });
        const now = yield* approvalToken(change);
        if (now !== token) return yield* fail(refusal(token, now, again));
        for (const column of change.columns) {
          if (column.image !== "insert") continue;
          yield* sql`
            INSERT INTO images (id, url, alt, placeholder, width, height, created_at, updated_at)
            VALUES (${column.to.imageId}::uuid, ${column.to.url}, ${column.to.alt},
              ${column.to.placeholder}, ${column.to.width}, ${column.to.height}, now(), now())`;
        }
        for (const column of change.columns) {
          if (column.image === "unchanged") continue;
          const name = column.column.slice(row.table.length + 1);
          yield* sql`
            UPDATE ${sql(row.table)}
            SET ${sql(name)} = ${column.to.imageId}::uuid, updated_at = now()
            WHERE id = ${row.id}::uuid`;
        }
        const deleted = new Set<string>();
        for (const column of change.columns) {
          const replaced = column.replaced;
          if (replaced?.row !== "delete" || deleted.has(replaced.imageId)) {
            continue;
          }
          deleted.add(replaced.imageId);
          yield* sql`DELETE FROM images WHERE id = ${replaced.imageId}::uuid`;
        }
        return change;
      }),
    );
  });

/**
 * A change in a few lines: each column, what it points at, and what
 * happens to the images it involves; in the past tense once `done`.
 */
export const changeLines = (change: ImageChange, done: boolean) =>
  change.columns.flatMap((column) => {
    const { to } = column;
    const size = `${to.width}×${to.height} ${to.format}, ${to.bytes} bytes, sha-256 ${to.sha256}`;
    if (column.image === "unchanged") {
      return [`${column.column}: already ${to.url} (${to.file}); unchanged`];
    }
    return [
      `${column.column}: ${column.from === null ? "none" : `${column.from.imageId} ${column.from.url}`}`,
      `  → ${to.imageId} ${to.url}`,
      `    from ${to.file}: ${size}, alt "${to.alt}"`,
      column.image === "insert"
        ? `    ${done ? "stored" : "store"} ${to.key} and ${done ? "added" : "add"} its images row`
        : `    ${done ? "reused" : "reuse"} its images row, written by an earlier run`,
      ...(column.replaced === null
        ? []
        : [
            column.replaced.row === "delete"
              ? `    ${done ? "deleted" : "delete"} the images row of ${column.replaced.imageId}: nothing else uses it`
              : `    ${done ? "kept" : "keep"} the images row of ${column.replaced.imageId}: also used by ${column.replaced.usedBy.join(", ")}`,
            `    ${done ? "kept" : "keep"} its object in the bucket: ${column.replaced.url}`,
          ]),
    ];
  });
