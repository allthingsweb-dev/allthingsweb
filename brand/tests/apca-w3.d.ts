declare module "apca-w3" {
  /** Screen luminance from 8-bit sRGB components. */
  export function sRGBtoY(rgb: readonly [number, number, number]): number;
  /** APCA lightness contrast (Lc); negative for light text on dark. */
  export function APCAcontrast(textY: number, backgroundY: number): number;
}
