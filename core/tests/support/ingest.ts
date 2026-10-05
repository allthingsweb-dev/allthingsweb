import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { CoverLookupError, CoverSource } from "../../src/ingest/covers.ts";
import {
  MediaBucket,
  MediaBucketError,
  publicUrl,
} from "../../src/ingest/media-bucket.ts";
import { PictureError, Pictures } from "../../src/ingest/pictures.ts";

/**
 * Image ingestion's outside world, faked: the hosts images are downloaded
 * from, the image processing the Worker does with Cloudflare's Images
 * binding, the media bucket, and Luma's cover lookup. Every fake records
 * what it was asked, and none reaches a network.
 */

export const mediaOrigin = "https://media.allthings.dev";

const ascii = (text: string) => Array.from(new TextEncoder().encode(text));

/** Bytes that begin like an image of `format`, then `tag`, so each image is distinct. */
export function imageBytes(
  format: "png" | "jpeg" | "gif" | "webp" | "avif" | "heic",
  tag: string,
): Uint8Array {
  const head = {
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    jpeg: [0xff, 0xd8, 0xff, 0xe0],
    gif: ascii("GIF89a"),
    webp: [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")],
    avif: [0, 0, 0, 20, ...ascii("ftypavif"), 0, 0, 0, 0, ...ascii("mif1")],
    heic: [0, 0, 0, 20, ...ascii("ftypheic"), 0, 0, 0, 0, ...ascii("mif1")],
  }[format];
  return new Uint8Array([...head, ...ascii(`:${tag}`)]);
}

const formatOf = (bytes: Uint8Array): string | undefined => {
  const starts = (head: ReadonlyArray<number>, offset = 0) =>
    head.every((byte, index) => bytes[offset + index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(ascii("GIF8"))) return "gif";
  if (starts(ascii("RIFF")) && starts(ascii("WEBP"), 8)) return "webp";
  if (starts(ascii("ftyp"), 4)) {
    return starts(ascii("heic"), 8) ? "heic" : "avif";
  }
  return undefined;
};

const tagOf = (bytes: Uint8Array) => {
  const text = String.fromCharCode(...bytes);
  return text.slice(text.lastIndexOf(":") + 1);
};

/**
 * Processing, faked: an image's format is its signature's, its size comes
 * from its tag's length (so images differ), a JPEG of it keeps its tag, and
 * its placeholder names its format and tag.
 */
export const fakePictures = Layer.succeed(
  Pictures,
  Pictures.of({
    info: (bytes) => {
      const format = formatOf(bytes);
      return format === undefined
        ? Effect.fail(new PictureError({ reason: "unsupported image" }))
        : Effect.succeed({
            format,
            width: 100 * tagOf(bytes).length,
            height: 10 * tagOf(bytes).length,
          });
    },
    toJpeg: (bytes) => Effect.succeed(imageBytes("jpeg", tagOf(bytes))),
    placeholder: (bytes) =>
      Effect.succeed(
        `data:image/jpeg;base64,${btoa(`${formatOf(bytes)}:${tagOf(bytes)}`)}`,
      ),
  }),
);

/** What the fake bucket was asked. */
export interface BucketLog {
  readonly put: Array<{ key: string; contentType: string; bytes: number }>;
  readonly removed: Array<string>;
}

/**
 * The media bucket, faked. `beforeStore` runs as an object is stored, so a
 * test can change the database between the download and the save.
 */
export function fakeBucket(
  beforeStore: (key: string) => Promise<void> = async () => undefined,
) {
  const log: BucketLog = { put: [], removed: [] };
  const store = async (key: string, bytes: Uint8Array, contentType: string) => {
    await beforeStore(key);
    log.put.push({ key, contentType, bytes: bytes.byteLength });
    return publicUrl(mediaOrigin, key);
  };
  const layer = Layer.succeed(
    MediaBucket,
    MediaBucket.of({
      put: (key, bytes, contentType) =>
        Effect.tryPromise({
          try: () => store(key, bytes, contentType),
          catch: (cause) =>
            new MediaBucketError({ reason: "store failed", cause }),
        }),
      remove: (key) =>
        Effect.sync(() => {
          log.removed.push(key);
        }),
    }),
  );
  return { layer, log, store };
}

/**
 * The hosts images come from, faked: each URL answers its bytes, a redirect
 * (a string), or a status; anything else is 404.
 */
export function fakeHosts(
  answers: Readonly<Record<string, Uint8Array | string | number>>,
) {
  const asked: Array<string> = [];
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      asked.push(url.href);
      const answer = answers[url.href];
      const response =
        answer instanceof Uint8Array
          ? new Response(answer)
          : typeof answer === "string"
            ? new Response(null, { status: 302, headers: { location: answer } })
            : new Response(null, { status: answer ?? 404 });
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  return { layer: Layer.succeed(HttpClient.HttpClient, client), asked };
}

/** Luma's covers, faked: a URL, no cover (null), or a failed lookup (an Error). */
export const fakeCovers = (
  covers: Readonly<Record<string, string | null | Error>>,
) =>
  Layer.succeed(
    CoverSource,
    CoverSource.of({
      find: Option.some((lumaEventId: string) => {
        const cover = covers[lumaEventId];
        return cover instanceof Error
          ? Effect.fail(new CoverLookupError({ reason: cover.message }))
          : Effect.succeed(cover ?? null);
      }),
    }),
  );

/** Image ids in a fixed order: the nth new image gets the nth. */
export const sequentialIds = () => {
  let n = 0;
  return () => `90000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
