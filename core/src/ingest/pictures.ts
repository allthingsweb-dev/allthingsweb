import { Context, Effect, Schema } from "effect";

/**
 * What image ingestion needs done to a downloaded image before it is
 * stored, as a service: the app does it with sharp, heic-convert and openimg
 * (app/src/lib/image-processor.ts), which don't run in a Worker, so the
 * Worker provides it with Cloudflare's Images binding, and tests with a fake.
 */

/** An image's format and size. The format is lowercase and short: "jpeg", "png", "webp". */
export interface PictureInfo {
  readonly format: string;
  readonly width: number;
  readonly height: number;
}

/** Processing an image failed. */
export class PictureError extends Schema.TaggedError<PictureError>()(
  "PictureError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `Image processing failed: ${this.reason}`;
  }
}

export interface PicturesShape {
  /** The image's format and size, upright (as EXIF orientation shows it). */
  readonly info: (
    bytes: Uint8Array,
  ) => Effect.Effect<PictureInfo, PictureError>;
  /** The image as a JPEG. */
  readonly toJpeg: (
    bytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, PictureError>;
  /** A tiny preview of the image as a data URL, for `images.placeholder`. */
  readonly placeholder: (
    bytes: Uint8Array,
  ) => Effect.Effect<string, PictureError>;
}

export class Pictures extends Context.Service<Pictures, PicturesShape>()(
  "allthings/Pictures",
) {}

/** An image ready to store: its bytes and what its `images` row says of it. */
export interface StoredImage {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** The key's extension and the content type's subtype. */
  readonly format: string;
  readonly placeholder: string;
}

/**
 * Formats stored as JPEG instead, because not every browser shows them.
 * The app converts these to PNG; JPEG suits photos and is far smaller.
 */
export const convertedFormats: ReadonlySet<string> = new Set([
  "heic",
  "heif",
  "webp",
  "avif",
]);

/**
 * An image as it is stored: HEIC, HEIF, WebP and AVIF become JPEG, and every
 * other format keeps its bytes, as in the app. Not resized or re-encoded
 * otherwise; the site makes its own variants (web/src/images).
 */
export const processForStorage = (
  bytes: Uint8Array,
): Effect.Effect<StoredImage, PictureError, Pictures> =>
  Effect.gen(function* () {
    const pictures = yield* Pictures;
    const original = yield* pictures.info(bytes);
    const stored = convertedFormats.has(original.format)
      ? yield* pictures.toJpeg(bytes)
      : bytes;
    const info = stored === bytes ? original : yield* pictures.info(stored);
    return {
      bytes: stored,
      width: info.width,
      height: info.height,
      format: info.format,
      placeholder: yield* pictures.placeholder(stored),
    };
  });
