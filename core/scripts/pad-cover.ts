import sharp from "sharp";

/** A cover padded for Meetup: a JPEG, exactly 16:9. */
export interface PaddedCover {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * The smallest 16:9 frame that holds a `width` × `height` image whole:
 * 16k × 9k for the least k that fits both sides, so the ratio is exact.
 */
export function wideFrame(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const k = Math.max(Math.ceil(width / 16), Math.ceil(height / 9), 1);
  return { width: 16 * k, height: 9 * k };
}

const black = { r: 0, g: 0, b: 0, alpha: 1 };

/**
 * The most pixels a cover may decode to, and its padded frame hold: far
 * above any cover Luma serves (about 1–4 MP), far below what would exhaust
 * the command's memory.
 */
export const maxCoverPixels = 40_000_000;
export const maxFramePixels = 80_000_000;

/**
 * `bytes` centered on black in the smallest 16:9 frame that holds it whole,
 * so Meetup's 16:9 crop cuts nothing. Turned upright by its EXIF
 * orientation first; see-through pixels go black; never scaled. Refuses a
 * cover that decodes past {@link maxCoverPixels} or pads past
 * {@link maxFramePixels}.
 */
export async function padCover(bytes: Uint8Array): Promise<PaddedCover> {
  const { data, info } = await sharp(bytes, {
    limitInputPixels: maxCoverPixels,
  })
    .rotate()
    .flatten({ background: black })
    .png()
    .toBuffer({ resolveWithObject: true });
  const frame = wideFrame(info.width, info.height);
  if (frame.width * frame.height > maxFramePixels) {
    throw new Error(
      `A ${info.width} × ${info.height} cover pads to ${frame.width} × ${frame.height}, over ${maxFramePixels} pixels`,
    );
  }
  const left = Math.floor((frame.width - info.width) / 2);
  const top = Math.floor((frame.height - info.height) / 2);
  const padded = await sharp(data, { limitInputPixels: maxCoverPixels })
    .extend({
      left,
      right: frame.width - info.width - left,
      top,
      bottom: frame.height - info.height - top,
      background: black,
    })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { bytes: new Uint8Array(padded), ...frame };
}
