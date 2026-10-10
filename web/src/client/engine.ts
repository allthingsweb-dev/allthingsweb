import type { GL } from "./gl.ts";

/**
 * What an engine is handed and what it answers to. An engine draws into
 * its surface's canvas each frame, from the photos the surface already
 * shows without script (its tiles), and moves with the pointer.
 */

/** A photo the surface shows, where it shows it, in CSS pixels. */
export interface Tile {
  readonly image: HTMLImageElement;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The pointer over the surface, in CSS pixels from its top left. */
export interface Pointer {
  readonly x: number;
  readonly y: number;
  /** How far it moved since the last event. */
  readonly dx: number;
  readonly dy: number;
  /** A press or a touch, rather than a hover. */
  readonly pressed: boolean;
}

export interface EngineContext {
  readonly gl: GL;
  readonly canvas: HTMLCanvasElement;
  readonly tiles: ReadonlyArray<Tile>;
}

export interface Engine {
  /** The surface is `width` by `height` CSS pixels, drawn at `scale`. */
  resize(width: number, height: number, scale: number): void;
  pointer(pointer: Pointer): void;
  /** One frame, `time` seconds in, `step` seconds after the last. */
  frame(time: number, step: number): void;
}

export type MakeEngine = (context: EngineContext) => Engine;

/** Draws `image` to cover the box, cropped about its center, as object-fit does. */
export function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  context.drawImage(
    image,
    (image.naturalWidth - sourceWidth) / 2,
    (image.naturalHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

/**
 * The tiles composed as one picture of the surface, `width` by `height`
 * CSS pixels at `scale`: what a full-screen engine samples. A surface its
 * tiles don't reach is filled by repeating them.
 */
export function mosaic(
  tiles: ReadonlyArray<Tile>,
  width: number,
  height: number,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (context === null || tiles.length === 0) return canvas;
  const reach = Math.max(...tiles.map((tile) => tile.x + tile.width));
  const depth = Math.max(...tiles.map((tile) => tile.y + tile.height));
  context.scale(scale, scale);
  for (let left = 0; left < width; left += reach) {
    for (let top = 0; top < height; top += depth) {
      for (const tile of tiles) {
        if (left + tile.x > width || top + tile.y > height) continue;
        drawCover(
          context,
          tile.image,
          left + tile.x,
          top + tile.y,
          tile.width,
          tile.height,
        );
      }
    }
  }
  return canvas;
}
