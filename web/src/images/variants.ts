import type * as Rows from "allthings-core/src/rows.ts";
import { mediaOrigin } from "../links.ts";

/**
 * Image variants: photos from the media origin, resized and re-encoded by
 * the Worker (see route.ts) at a few fixed sizes and formats, under one URL
 * each on this site:
 *
 *     /img/<size>/<format>/<version>/<key>
 *
 * - `size` is a width ("480"), which keeps the photo's proportions and never
 *   enlarges it, or a square ("36x36"), which crops the photo to fill it.
 *   Only the sizes below exist, so the variants the Worker makes are few
 *   and known.
 * - `format` is avif, webp or jpeg. Pages offer the first two and keep JPEG
 *   for browsers that read neither.
 * - `version` is the image row's (see `Rows.Photo`): a changed row gets new
 *   URLs, so a variant never changes under its URL and is cached for good.
 * - `key` is the object's key on the media origin, each segment
 *   percent-encoded as the app writes it.
 *
 * Each variant has exactly one URL: anything else under /img/ is not found,
 * and the Worker only ever fetches `<media origin>/<key>` for a key that
 * passes the same checks the upload Worker applies.
 */

/**
 * The widths photos are offered at, for `srcset`: enough steps that a
 * browser picks one within about a third of what it shows, at 1x to 3x.
 * Cloudflare encodes AVIF up to 1,200 pixels on a side, so every width
 * here comes in every format.
 */
export const widths = [240, 360, 480, 720, 960, 1200] as const;

/** The squares portraits are offered at: 36 CSS pixels at 1x and 2x. */
export const squares = [36, 72] as const;

export type Width = (typeof widths)[number];
export type Square = (typeof squares)[number];

/** A variant's box: a width, or a square to fill. */
export type Size =
  | { readonly kind: "width"; readonly width: Width }
  | { readonly kind: "square"; readonly side: Square };

/** The formats variants are encoded in, by their name in the URL. */
export const formats = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
} as const;

export type Format = keyof typeof formats;

/** One variant of one photo. */
export interface Variant {
  readonly size: Size;
  readonly format: Format;
  readonly version: string;
  /** The object's key on the media origin, decoded. */
  readonly key: string;
}

/** A photo the Worker can make variants of. */
export interface Source {
  readonly key: string;
  readonly version: string;
}

/**
 * A key segment as the app and the upload Worker write them: letters, marks,
 * digits and `._-`, never starting with a dot, and never holding "..".
 */
const segment = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}._-]*$/u;

/** Only photos the Images binding reads are offered. */
const imageExtension = /\.(?:avif|gif|jpe?g|png|webp)$/i;

/** Longer keys than the app ever writes are refused. */
const maxKeyLength = 512;

const versionPattern = /^[0-9]{1,12}$/;

/** Whether `key` (decoded) is one the Worker may fetch from the media origin. */
export function isKey(key: string): boolean {
  if (key.length > maxKeyLength || !imageExtension.test(key)) return false;
  return key
    .split("/")
    .every((part) => segment.test(part) && !part.includes(".."));
}

/** The key as a URL path, each segment percent-encoded. */
export const encodeKey = (key: string): string =>
  key.split("/").map(encodeURIComponent).join("/");

const sizeName = (size: Size): string =>
  size.kind === "width" ? String(size.width) : `${size.side}x${size.side}`;

/** The variant's one URL path on this site. */
export const variantPath = ({ size, format, version, key }: Variant): string =>
  `/img/${sizeName(size)}/${format}/${version}/${encodeKey(key)}`;

const isWidth = (value: number): value is Width =>
  widths.some((width) => width === value);

const isSquare = (value: number): value is Square =>
  squares.some((side) => side === value);

const isFormat = (value: string): value is Format =>
  Object.hasOwn(formats, value);

function parseSize(name: string): Size | undefined {
  const square = /^([0-9]{2,4})x\1$/.exec(name);
  if (square !== null) {
    const side = Number(square[1]);
    return isSquare(side) ? { kind: "square", side } : undefined;
  }
  if (!/^[0-9]{3,4}$/.test(name)) return undefined;
  const width = Number(name);
  return isWidth(width) ? { kind: "width", width } : undefined;
}

const decodeSegment = (part: string): string | undefined => {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
};

/**
 * The variant a URL path names, or `undefined` unless the path is exactly
 * the one `variantPath` writes for it: other sizes and formats, keys that
 * aren't keys, and other spellings of the same variant (encoded or doubled
 * slashes, dot segments, needless escapes) are all refused.
 */
export function parseVariant(pathname: string): Variant | undefined {
  const [empty, img, size, format, versionName, ...keyParts] =
    pathname.split("/");
  if (empty !== "" || img !== "img" || keyParts.length === 0) return undefined;
  const parsedSize = size === undefined ? undefined : parseSize(size);
  if (parsedSize === undefined) return undefined;
  if (format === undefined || !isFormat(format)) return undefined;
  if (versionName === undefined || !versionPattern.test(versionName)) {
    return undefined;
  }
  const decoded = keyParts.map(decodeSegment);
  if (decoded.some((part) => part === undefined)) return undefined;
  const key = decoded.join("/");
  if (!isKey(key)) return undefined;
  const variant: Variant = {
    size: parsedSize,
    format,
    version: versionName,
    key,
  };
  return variantPath(variant) === pathname ? variant : undefined;
}

/**
 * The photo as a source of variants: its key on the media origin, when it
 * is there under a key the Worker accepts, with its version.
 */
export function sourceOf(photo: Rows.Photo): Source | undefined {
  const prefix = `${mediaOrigin}/`;
  if (!photo.url.startsWith(prefix) || !versionPattern.test(photo.version)) {
    return undefined;
  }
  const decoded = photo.url.slice(prefix.length).split("/").map(decodeSegment);
  if (decoded.some((part) => part === undefined)) return undefined;
  const key = decoded.join("/");
  return isKey(key) ? { key, version: photo.version } : undefined;
}
