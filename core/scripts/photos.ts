import { BunRuntime, BunServices } from "@effect/platform-bun";
import { basename } from "node:path";
import { Config, Console, Effect, Redacted } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import {
  addPhotos,
  parseTarget,
  type PhotoFile,
  type PhotoResult,
  type Replaced,
  replacePhoto,
} from "../src/photos.ts";
import { encodeKey, type Media } from "../src/reencode.ts";
import { encode, placeholder } from "./encode.ts";

/**
 * An evening's photos (src/photos.ts), in the Postgres at DATABASE_URL.
 *
 *   bun run photos add <event slug> <file>… --alt "…" [--alt "…"]… [--dry-run] [--json]
 *   bun run photos replace <event slug> <image id | position> <file> --alt "…" [--dry-run] [--json]
 *
 * One --alt per file, in the files' order, saying what the photo shows
 * without naming anyone from their face. The photos go on the evening in
 * that order, after any it has. Each is re-encoded (upright, at most 4096
 * pixels on its long edge, JPEG, every bit of metadata, location included,
 * stripped) and stored under a key named after the file's contents, so
 * adding a file again changes nothing. HEIC is not read: export JPEGs.
 *
 * replace puts <file> in the place of one of the evening's photos, named by
 * its image id or its position on the page (from 1): the old link and its
 * images row are deleted in the same transaction, only when nothing else
 * points at that row. The old object stays in the bucket.
 *
 * --dry-run encodes and checks every file and rehearses the database writes,
 * then rolls them back; it stores nothing and needs no upload credentials.
 *
 * DATABASE_URL (the database owner's connection string), MEDIA_UPLOAD_URL
 * and MEDIA_UPLOAD_TOKEN (the upload Worker the app stores media through)
 * come from the environment only; .env files are not read. Pass them
 * without printing them, as scripts/reencode-originals.ts shows.
 */

const origin = "https://media.allthings.dev";

/** The media origin, and the upload Worker behind it, over HTTP. */
const httpMedia = (uploadUrl: string, token: Redacted.Redacted): Media => ({
  size: async (url) => {
    const response = await fetch(url, { method: "HEAD" });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`HEAD ${url}: ${response.status}`);
    const length = response.headers.get("content-length");
    if (length === null) throw new Error(`HEAD ${url}: no content-length`);
    return Number(length);
  },
  get: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  put: async (key, bytes, contentType) => {
    const response = await fetch(`${uploadUrl}/${encodeKey(key)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${Redacted.value(token)}`,
        "content-type": contentType,
      },
      body: bytes,
    });
    if (response.status === 409) return "exists";
    if (!response.ok) throw new Error(`PUT ${key}: ${response.status}`);
    return "created";
  },
});

/** A dry run never reaches the bucket. */
const noMedia: Media = {
  size: () => Promise.reject(new Error("a dry run stores nothing")),
  get: () => Promise.reject(new Error("a dry run stores nothing")),
  put: () => Promise.reject(new Error("a dry run stores nothing")),
};

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** A stored photo in one line: file, key, size and alt text. */
const summary = (photo: Omit<PhotoResult, "status">) =>
  `${photo.file} → ${photo.key} (${photo.width}×${photo.height}, ${mb(photo.bytes)}) "${photo.alt}"`;

const line = (photo: PhotoResult) => `${photo.status}: ${summary(photo)}`;

const add = Command.make(
  "add",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening's slug or short link."),
    ),
    files: Argument.String("files").pipe(
      Argument.withDescription("The photos, in the order they should show."),
      Argument.atLeast(1),
    ),
    alt: Flag.String("alt").pipe(
      Flag.withDescription(
        "What a photo shows, one per file in the files' order; never names people from their faces.",
      ),
      Flag.atLeast(1),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Encode, check and rehearse everything; store and write nothing.",
      ),
      Flag.withDefault(false),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the results as JSON."),
      Flag.withDefault(false),
    ),
  },
  ({ slug, files, alt, dryRun, json }) =>
    Effect.gen(function* () {
      if (alt.length !== files.length) {
        yield* Effect.fail(
          new Error(
            `${files.length} files but ${alt.length} --alt texts: give one per file, in order.`,
          ),
        );
      }
      const photos: Array<PhotoFile> = [];
      for (const [index, path] of files.entries()) {
        const bytes = yield* Effect.tryPromise({
          try: () => Bun.file(path).bytes(),
          catch: (cause) =>
            new Error(`${path} could not be read: ${String(cause)}`),
        });
        photos.push({ name: basename(path), bytes, alt: alt[index]! });
      }
      const media = dryRun
        ? noMedia
        : httpMedia(
            (yield* Config.String("MEDIA_UPLOAD_URL")).replace(/\/+$/, ""),
            yield* Config.Redacted("MEDIA_UPLOAD_TOKEN"),
          );
      const results = yield* addPhotos(slug, photos, {
        media,
        encode,
        placeholder,
        origin,
        dryRun,
      });
      yield* Console.log(
        json
          ? JSON.stringify({ slug, dryRun, photos: results }, null, 2)
          : [
              ...results.map(line),
              dryRun ? "Dry run: stored nothing, rolled back." : "",
            ]
              .filter((text) => text !== "")
              .join("\n"),
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Add photos to an evening, in order: re-encoded, stored and recorded once each.",
  ),
);

const replacedLine = (replaced: Replaced) =>
  `${replaced.new.status}: photo ${replaced.old.position} (image ${replaced.old.imageId}; its object stays in the bucket) with ${summary(replaced.new)}`;

const replace = Command.make(
  "replace",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening's slug or short link."),
    ),
    target: Argument.String("photo").pipe(
      Argument.withDescription(
        "The photo to replace: its image id, or its position on the page (from 1).",
      ),
    ),
    file: Argument.String("file").pipe(
      Argument.withDescription("The new photo."),
    ),
    alt: Flag.String("alt").pipe(
      Flag.withDescription(
        "What the new photo shows; never names people from their faces.",
      ),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Encode, check and rehearse everything; store and write nothing.",
      ),
      Flag.withDefault(false),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the result as JSON."),
      Flag.withDefault(false),
    ),
  },
  ({ slug, target, file, alt, dryRun, json }) =>
    Effect.gen(function* () {
      const parsed =
        parseTarget(target) ??
        (yield* Effect.fail(
          new Error(
            `${target} is neither an image id nor a position (1, 2, …).`,
          ),
        ));
      const bytes = yield* Effect.tryPromise({
        try: () => Bun.file(file).bytes(),
        catch: (cause) =>
          new Error(`${file} could not be read: ${String(cause)}`),
      });
      const media = dryRun
        ? noMedia
        : httpMedia(
            (yield* Config.String("MEDIA_UPLOAD_URL")).replace(/\/+$/, ""),
            yield* Config.Redacted("MEDIA_UPLOAD_TOKEN"),
          );
      const replaced = yield* replacePhoto(
        slug,
        parsed,
        { name: basename(file), bytes, alt },
        { media, encode, placeholder, origin, dryRun },
      );
      yield* Console.log(
        json
          ? JSON.stringify({ slug, dryRun, ...replaced }, null, 2)
          : [
              replacedLine(replaced),
              dryRun ? "Dry run: stored nothing, rolled back." : "",
            ]
              .filter((text) => text !== "")
              .join("\n"),
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Replace one of an evening's photos in its place; the old object stays in the bucket.",
  ),
);

const photos = Command.make("photos").pipe(
  Command.withDescription("An evening's photos."),
  Command.withSubcommands([add, replace]),
);

Command.run(photos, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
