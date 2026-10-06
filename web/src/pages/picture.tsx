import { portrait } from "allthings-brand/src/layout.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import {
  type Format,
  type Size,
  type Source,
  type Square,
  sourceOf,
  variantPath,
  type Width,
  widths,
} from "../images/variants.ts";

/**
 * How pages show photos. With "variants" (the Worker has its Images
 * binding), every photo comes from this site at the sizes and formats
 * images/variants.ts lists: AVIF, else WebP, else JPEG, at the width the
 * browser needs, so the media origin is never loaded. With "originals"
 * (no binding, as in tests that bind none), photos link their originals on
 * the media origin, as large as they were uploaded.
 */
export type ImageMode = "variants" | "originals";

/** The formats offered as <source>s, best first; JPEG is the <img>'s own. */
const sourceFormats: ReadonlyArray<Format> = ["avif", "webp"];

/** The photos a page in `mode` can show: in "variants", those with a source. */
export const showable = (
  photos: ReadonlyArray<Rows.Photo>,
  mode: ImageMode,
): ReadonlyArray<Rows.Photo> =>
  mode === "originals"
    ? photos
    : photos.filter((photo) => sourceOf(photo) !== undefined);

/** A width variant and the width it comes out at. */
interface Candidate {
  readonly width: Width;
  readonly actual: number;
}

/**
 * The widths a photo `width` pixels wide is offered at: those it has, since
 * a variant is never enlarged. A photo narrower than every width comes once,
 * at its own width.
 */
function candidates(width: number): ReadonlyArray<Candidate> {
  const fitting = widths.filter((candidate) => candidate <= width);
  return fitting.length === 0
    ? [{ width: widths[0], actual: width }]
    : fitting.map((candidate) => ({ width: candidate, actual: candidate }));
}

const path = (source: Source, size: Size, format: Format) =>
  variantPath({ ...source, size, format });

const widthSrcset = (
  source: Source,
  format: Format,
  offered: ReadonlyArray<Candidate>,
) =>
  offered
    .map(
      ({ width, actual }) =>
        `${path(source, { kind: "width", width }, format)} ${actual}w`,
    )
    .join(", ");

interface ImgProps {
  readonly src: string;
  readonly srcset?: string | undefined;
  readonly sizes?: string | undefined;
  readonly alt: string;
  readonly width: string;
  readonly height: string;
  readonly class?: string | undefined;
  /** Loaded at once, as what the page leads with is. */
  readonly eager?: true | undefined;
  /** Loaded after everything else, as the footer's portraits are. */
  readonly last?: true | undefined;
}

/** An image that loads lazily, unless `eager`, and decodes off the main thread. */
function Img({
  src,
  srcset,
  sizes,
  alt,
  width,
  height,
  class: className,
  eager,
  last,
}: ImgProps) {
  return (
    <img
      class={className}
      src={src}
      srcset={srcset}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={eager === undefined ? "lazy" : undefined}
      decoding="async"
      fetchpriority={last === undefined ? undefined : "low"}
    />
  );
}

export interface PhotoProps {
  readonly photo: Rows.Photo;
  readonly mode: ImageMode;
  /** The <img> `sizes`: how wide the layout shows the photo. */
  readonly sizes: string;
}

/**
 * A photo at its intrinsic size (its width and height keep the layout from
 * shifting) and with its alt text. In "variants", a <picture> offering
 * every width the photo has in AVIF and WebP, and in JPEG to the rest.
 * A photo without a source shows nothing; `showable` leaves it out first.
 */
export function Photo({ photo, mode, sizes }: PhotoProps) {
  const img = {
    alt: photo.alt,
    width: String(photo.width),
    height: String(photo.height),
  };
  if (mode === "originals") return <Img src={photo.url} {...img} />;
  const source = sourceOf(photo);
  if (source === undefined) return "";
  const offered = candidates(photo.width);
  // The <img>'s own src, for browsers without srcset: a middling width.
  const fallback = offered.find(({ width }) => width >= 480) ?? offered.at(-1);
  return (
    <picture>
      {sourceFormats.map((format) => (
        <source
          type={`image/${format}`}
          srcset={widthSrcset(source, format, offered)}
          sizes={sizes}
        />
      ))}
      <Img
        src={path(
          source,
          { kind: "width", width: fallback?.width ?? widths[0] },
          "jpeg",
        )}
        srcset={widthSrcset(source, "jpeg", offered)}
        sizes={sizes}
        {...img}
      />
    </picture>
  );
}

/** The squares a photo is offered at: those it fills without enlarging. */
function squaresOf(
  photo: Rows.Photo,
  sides: ReadonlyArray<Square>,
): ReadonlyArray<Square> {
  const fitting = sides.filter(
    (side) => side <= Math.min(photo.width, photo.height),
  );
  return fitting.length === 0 ? sides.slice(0, 1) : fitting;
}

export interface SquarePhotoProps {
  readonly photo: Rows.Photo;
  readonly mode: ImageMode;
  /** How many CSS pixels square it is shown at most: its width and height. */
  readonly side: number;
  /**
   * The squares offered. With `sizes`, each by its width; without, the
   * first at 1x, the next at 2x, and so on.
   */
  readonly sides: ReadonlyArray<Square>;
  readonly sizes?: string | undefined;
  readonly alt: string;
  readonly class?: string | undefined;
  readonly eager?: true | undefined;
  readonly last?: true | undefined;
}

/**
 * A photo cropped square to fill its box: a portrait. In "variants", a
 * <picture> offering the squares in AVIF, WebP and JPEG; in "originals",
 * the original, however large. A photo without a source shows nothing, so
 * the caller can show the blank avatar instead (see `hasSource`).
 */
export function SquarePhoto({
  photo,
  mode,
  side,
  sides,
  sizes,
  ...rest
}: SquarePhotoProps) {
  const img = { ...rest, width: String(side), height: String(side) };
  if (mode === "originals") return <Img src={photo.url} {...img} />;
  const source = sourceOf(photo);
  if (source === undefined) return "";
  const offered = squaresOf(photo, sides);
  const srcset = (format: Format) =>
    offered
      .map(
        (square, index) =>
          `${path(source, { kind: "square", side: square }, format)} ${sizes === undefined ? `${index + 1}x` : `${square}w`}`,
      )
      .join(", ");
  return (
    <picture>
      {sourceFormats.map((format) => (
        <source
          type={`image/${format}`}
          srcset={srcset(format)}
          sizes={sizes}
        />
      ))}
      <Img
        src={path(
          source,
          { kind: "square", side: offered[0] ?? sides[0] ?? 36 },
          "jpeg",
        )}
        srcset={srcset("jpeg")}
        sizes={sizes}
        {...img}
      />
    </picture>
  );
}

/** Whether a page in `mode` can show `photo` (else the blank avatar). */
export const hasSource = (photo: Rows.Photo, mode: ImageMode): boolean =>
  mode === "originals" || sourceOf(photo) !== undefined;

export interface PortraitProps {
  readonly photo: Rows.Photo | undefined;
  readonly mode: ImageMode;
  /** What stands in without a photo to show: the brand's blank avatar. */
  readonly blank: string;
  /** Who it is. */
  readonly alt: string;
}

/**
 * A portrait in the footer: 36 CSS pixels square, cropped to fill, loaded
 * lazily, last and off the main thread, at 1x and 2x.
 */
export function Portrait({ photo, mode, blank, alt }: PortraitProps) {
  if (photo === undefined || !hasSource(photo, mode)) {
    return (
      <Img
        src={blank}
        alt={alt}
        width={String(portrait.xs)}
        height={String(portrait.xs)}
        last
      />
    );
  }
  return (
    <SquarePhoto
      photo={photo}
      mode={mode}
      side={portrait.xs}
      sides={[36, 72]}
      alt={alt}
      last
    />
  );
}
