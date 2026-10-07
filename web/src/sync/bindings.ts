import {
  encodeKey,
  MediaBucket,
  MediaBucketError,
  maxMediaBytes,
  publicUrl,
} from "allthings-core/src/ingest/media-bucket.ts";
import {
  PictureError,
  Pictures,
  type PictureInfo,
} from "allthings-core/src/ingest/pictures.ts";
import { Effect } from "effect";

/**
 * The sync Worker's bindings as the services core's image ingestion uses:
 * its R2 bucket as `MediaBucket`, and Cloudflare's Images binding as
 * `Pictures` (format, size, JPEG and placeholder, which the app does with
 * sharp, heic-convert and openimg).
 */

/** What the sync uses of an R2 bucket binding (workerd's `R2Bucket`). */
export interface R2BucketBinding {
  readonly put: (
    key: string,
    value: Uint8Array,
    options: {
      readonly onlyIf: Headers;
      readonly httpMetadata: { readonly contentType: string };
    },
  ) => Promise<unknown>;
  readonly delete: (key: string) => Promise<void>;
}

/**
 * The bucket behind `origin`. It never replaces an object: like the upload
 * Worker, it stores only if nothing is at the key (`If-None-Match: *`), since
 * the site caches each photo's variants under URLs derived from its key.
 */
export const mediaBucket = (bucket: R2BucketBinding, origin: string) =>
  MediaBucket.of({
    put: (key, bytes, contentType) =>
      bytes.byteLength > maxMediaBytes
        ? Effect.fail(
            new MediaBucketError({
              reason: `${key} is ${bytes.byteLength} bytes, over the ${maxMediaBytes} an image may be`,
            }),
          )
        : Effect.tryPromise({
            try: () =>
              bucket.put(key, bytes, {
                onlyIf: new Headers({ "if-none-match": "*" }),
                httpMetadata: { contentType },
              }),
            catch: (cause) =>
              new MediaBucketError({ reason: `Storing ${key} failed`, cause }),
          }).pipe(
            Effect.flatMap((stored) =>
              stored === null
                ? Effect.fail(
                    new MediaBucketError({
                      reason: `An object already exists at ${key}`,
                    }),
                  )
                : Effect.succeed(publicUrl(origin, key)),
            ),
          ),
    remove: (key) =>
      Effect.tryPromise({
        try: () => bucket.delete(key),
        catch: (cause) =>
          new MediaBucketError({ reason: `Deleting ${key} failed`, cause }),
      }),
  });

/**
 * The bucket behind `origin`, reached through the upload Worker at
 * `uploadUrl` (infra/src/upload-worker.ts) with its bearer token. That is how
 * the sync stores images while media.allthings.dev serves a bucket in another
 * account than this Worker's, the one the app and core's scripts store to.
 * The upload Worker, like the binding, never replaces an object: it answers
 * 409 where one exists. Nothing it answers ever carries the token.
 */
export const uploadWorkerBucket = (
  uploadUrl: string,
  token: string,
  origin: string,
  fetch: typeof globalThis.fetch,
) => {
  const base = uploadUrl.replace(/\/+$/, "");
  const send = (
    key: string,
    method: "PUT" | "DELETE",
    body?: { readonly bytes: Uint8Array; readonly contentType: string },
  ) =>
    Effect.tryPromise({
      try: () =>
        fetch(`${base}/${encodeKey(key)}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "content-type": body.contentType }),
          },
          ...(body === undefined ? {} : { body: body.bytes }),
        }),
      catch: (cause) =>
        new MediaBucketError({
          reason: `${method === "PUT" ? "Storing" : "Deleting"} ${key} through the upload Worker failed`,
          cause,
        }),
    });
  return MediaBucket.of({
    put: (key, bytes, contentType) =>
      bytes.byteLength > maxMediaBytes
        ? Effect.fail(
            new MediaBucketError({
              reason: `${key} is ${bytes.byteLength} bytes, over the ${maxMediaBytes} an image may be`,
            }),
          )
        : send(key, "PUT", { bytes, contentType }).pipe(
            Effect.flatMap((response) =>
              response.status === 201
                ? Effect.succeed(publicUrl(origin, key))
                : Effect.fail(
                    new MediaBucketError({
                      reason:
                        response.status === 409
                          ? `An object already exists at ${key}`
                          : `Storing ${key} through the upload Worker answered ${response.status}`,
                    }),
                  ),
            ),
          ),
    remove: (key) =>
      send(key, "DELETE").pipe(
        Effect.flatMap((response) =>
          response.status === 204
            ? Effect.void
            : Effect.fail(
                new MediaBucketError({
                  reason: `Deleting ${key} through the upload Worker answered ${response.status}`,
                }),
              ),
        ),
      ),
  });
};

/** What the sync uses of the Images binding (workerd's `ImagesBinding`). */
export interface ImagesInfoBinding {
  readonly info: (stream: ReadableStream<Uint8Array>) => Promise<{
    readonly format: string;
    readonly width?: number;
    readonly height?: number;
  }>;
  readonly input: (stream: ReadableStream<Uint8Array>) => {
    transform: (transform: {
      readonly width: number;
      readonly height: number;
      readonly fit: "scale-down";
    }) => {
      output: (options: {
        readonly format: "image/jpeg";
        readonly quality: number;
      }) => Promise<{ readonly response: () => Response }>;
    };
    output: (options: {
      readonly format: "image/jpeg";
      readonly quality: number;
    }) => Promise<{ readonly response: () => Response }>;
  };
}

const streamOf = (bytes: Uint8Array) => new Blob([bytes]).stream();

const bytesOf = async (result: { readonly response: () => Response }) =>
  new Uint8Array(await result.response().arrayBuffer());

/** The quality a converted photo is stored at: as good as the app's PNG to the eye, far smaller. */
export const jpegQuality = 90;

/** A placeholder's longest side, in pixels: enough for a blur-up. */
export const placeholderSize = 16;

const failed = (what: string) => (cause: unknown) =>
  new PictureError({
    reason: `${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });

/** Formats as the Images binding names them ("image/jpeg") and as keys do ("jpeg"). */
const shortFormat = (format: string) =>
  format.replace(/^image\//, "").replace(/\+xml$/, "");

export const pictures = (images: ImagesInfoBinding) =>
  Pictures.of({
    info: (bytes) =>
      Effect.tryPromise({
        try: () => images.info(streamOf(bytes)),
        catch: failed("reading the image"),
      }).pipe(
        Effect.flatMap(
          ({
            format,
            width,
            height,
          }): Effect.Effect<PictureInfo, PictureError> =>
            width === undefined || height === undefined
              ? Effect.fail(
                  new PictureError({
                    reason: `${format} has no size; only raster images are stored`,
                  }),
                )
              : Effect.succeed({ format: shortFormat(format), width, height }),
        ),
      ),
    toJpeg: (bytes) =>
      Effect.tryPromise({
        try: () =>
          images
            .input(streamOf(bytes))
            .output({ format: "image/jpeg", quality: jpegQuality })
            .then(bytesOf),
        catch: failed("converting the image to JPEG"),
      }),
    placeholder: (bytes) =>
      Effect.tryPromise({
        try: () =>
          images
            .input(streamOf(bytes))
            .transform({
              width: placeholderSize,
              height: placeholderSize,
              fit: "scale-down",
            })
            .output({ format: "image/jpeg", quality: 50 })
            .then(bytesOf),
        catch: failed("making the placeholder"),
      }).pipe(
        Effect.map(
          (jpeg) =>
            `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`,
        ),
      ),
  });
