/**
 * How long each platform lets a post be, and how it counts.
 *
 * - X: 280, weighted as X's own counter weighs text: most Latin, Greek,
 *   Cyrillic and general punctuation counts 1, everything else (CJK,
 *   emoji) 2, and every URL 23, whatever its length.
 * - Bluesky: 300 graphemes, links counted as written.
 * - LinkedIn: 3,000 characters for a post.
 * - Discord: 2,000 characters for a message.
 * - Meetup: 5,000 characters, what its event editor accepts (its API takes
 *   more, the editor doesn't).
 * - Luma: no published limit; its description is held to Meetup's 5,000 so
 *   the same body serves both.
 */

export type Platform =
  | "x"
  | "bluesky"
  | "linkedin"
  | "discord"
  | "meetup"
  | "luma";

export const limits: Readonly<Record<Platform, number>> = {
  x: 280,
  bluesky: 300,
  linkedin: 3000,
  discord: 2000,
  meetup: 5000,
  luma: 5000,
};

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

const urlPattern = /https?:\/\/\S+/gu;

/** The code points X counts as 1; everything else counts 2. */
const lightRanges: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

const xWeight = (codePoint: number): number =>
  lightRanges.some(([from, to]) => codePoint >= from && codePoint <= to)
    ? 1
    : 2;

/** A post's length as X counts it. */
export function xLength(text: string): number {
  let length = 0;
  let rest = text;
  for (const url of text.match(urlPattern) ?? []) {
    length += 23;
    rest = rest.replace(url, "");
  }
  for (const { segment } of graphemes.segment(rest)) {
    // An emoji sequence (a flag, a family) counts once, as 2.
    const first = segment.codePointAt(0) ?? 0;
    length += segment.length > 2 ? 2 : xWeight(first);
  }
  return length;
}

/** A post's length as `platform` counts it. */
export function lengthOn(platform: Platform, text: string): number {
  if (platform === "x") return xLength(text);
  if (platform === "bluesky") return [...graphemes.segment(text)].length;
  return text.length;
}

/** Whether `text` fits on `platform`. */
export const fits = (platform: Platform, text: string): boolean =>
  lengthOn(platform, text) <= limits[platform];

/** A draft that can't be made to fit, however much is left out. */
export class DraftTooLong extends Error {
  readonly platform: Platform;
  readonly length: number;

  constructor(platform: Platform, length: number) {
    super(
      `The shortest ${platform} draft is ${length}, over its limit of ${limits[platform]}`,
    );
    this.name = "DraftTooLong";
    this.platform = platform;
    this.length = length;
  }
}

/**
 * The first of `candidates`, richest first, that fits on `platform`.
 * Fails when even the last one doesn't, so a draft is never cut mid-word.
 */
export function fitOn(
  platform: Platform,
  candidates: ReadonlyArray<string>,
): string {
  for (const candidate of candidates) {
    if (fits(platform, candidate)) return candidate;
  }
  const last = candidates.at(-1) ?? "";
  throw new DraftTooLong(platform, lengthOn(platform, last));
}
