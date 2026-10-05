import type * as Rows from "allthings-core/src/rows.ts";
import {
  type Format,
  type Size,
  type Source,
  sourceOf,
  squares,
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
  /** Loaded after everything else, as the footer's portraits are. */
  readonly last?: true | undefined;
}

/** An image that loads lazily and decodes off the main thread. */
function Img({ src, srcset, sizes, alt, width, height, last }: ImgProps) {
  return (
    <img
      src={src}
      srcset={srcset}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
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

const squareSrcset = (source: Source, format: Format) =>
  squares
    .map(
      (side, index) =>
        `${path(source, { kind: "square", side }, format)} ${index + 1}x`,
    )
    .join(", ");

export interface PortraitProps {
  readonly photo: Rows.Photo | undefined;
  readonly mode: ImageMode;
  /** What stands in without a photo to show: the brand's blank avatar. */
  readonly blank: string;
}

/**
 * A portrait in the footer: 36 CSS pixels square, cropped to fill, loaded
 * lazily, last and off the main thread. In "variants", at 1x and 2x in
 * AVIF, WebP and JPEG; in "originals", the original, however large.
 */
export function Portrait({ photo, mode, blank }: PortraitProps) {
  const img = { alt: "", width: "36", height: "36", last: true } as const;
  if (photo === undefined) return <Img src={blank} {...img} />;
  if (mode === "originals") return <Img src={photo.url} {...img} />;
  const source = sourceOf(photo);
  if (source === undefined) return <Img src={blank} {...img} />;
  return (
    <picture>
      {sourceFormats.map((format) => (
        <source
          type={`image/${format}`}
          srcset={squareSrcset(source, format)}
        />
      ))}
      <Img
        src={path(source, { kind: "square", side: squares[0] }, "jpeg")}
        srcset={squareSrcset(source, "jpeg")}
        {...img}
      />
    </picture>
  );
}
