/**
 * Text contrast, judged two ways. APCA guides the design: it is the
 * perceptual model being explored for WCAG 3, and it rates light-on-dark and
 * dark-on-light text differently, as eyes do. WCAG 2.2's ratio is still the
 * standard every pairing must also meet. See brand/foundations.md, Color.
 *
 * APCA here is APCA-W3 0.0.98G-4g, the version the apca-w3 package (0.1.9)
 * implements; the tests hold the two to the same results.
 */

type Rgb = readonly [number, number, number];

/** 8-bit channels of a `#RRGGBB` color. */
export function rgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`Expected #RRGGBB, got ${hex}`);
  const channel = (value: string | undefined) =>
    Number.parseInt(value ?? "", 16);
  return [channel(match[1]), channel(match[2]), channel(match[3])];
}

/** APCA's screen luminance: a simple 2.4 power curve, not sRGB's piecewise one. */
function screenLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => (channel / 255) ** 2.4;
  return 0.2126729 * linear(r) + 0.7151522 * linear(g) + 0.072175 * linear(b);
}

/** Near-black luminances are lifted toward this threshold (flare). */
const blackThreshold = 0.022;
// oxlint-disable-next-line oxc/approx-constant -- APCA 0.0.98G defines this exponent as exactly 1.414, not √2
const blackClamp = 1.414;

const softClamp = (y: number) =>
  y > blackThreshold ? y : y + (blackThreshold - y) ** blackClamp;

/**
 * The APCA lightness contrast (Lc) of `text` on `background`: about 0 to 106
 * for dark text on light grounds, and about 0 to −108 for light text on dark.
 * Targets compare its magnitude.
 */
export function apcaContrast(text: string, background: string): number {
  const textY = softClamp(screenLuminance(rgb(text)));
  const backgroundY = softClamp(screenLuminance(rgb(background)));
  if (Math.abs(backgroundY - textY) < 0.0005) return 0;
  const scale = 1.14;
  const offset = 0.027;
  const lowClip = 0.1;
  if (backgroundY > textY) {
    const contrast = (backgroundY ** 0.56 - textY ** 0.57) * scale;
    return contrast < lowClip ? 0 : (contrast - offset) * 100;
  }
  const contrast = (backgroundY ** 0.65 - textY ** 0.62) * scale;
  return contrast > -lowClip ? 0 : (contrast + offset) * 100;
}

/** WCAG 2's relative luminance: sRGB's piecewise transfer curve. */
function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG 2 contrast ratio of two colors, from 1 to 21; order doesn't matter. */
export function wcagContrast(a: string, b: string): number {
  const [lighter, darker] = [
    relativeLuminance(rgb(a)),
    relativeLuminance(rgb(b)),
  ].toSorted((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}
