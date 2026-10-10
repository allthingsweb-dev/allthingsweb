import type { PropsWithChildren } from "@kitajs/html";
import type * as Rows from "allthings-core/src/rows.ts";
import { hasSource, type ImageMode, Photo, SquarePhoto } from "./picture.tsx";

/** A photo shown as texture beside the real text: it says nothing. */
const decorative = (photo: Rows.Photo): Rows.Photo => ({ ...photo, alt: "" });

/**
 * Letters made of people: a word set huge, its letters filled with photos
 * and the ground around them left exactly the ground. The heading is the
 * real word, as text; the photos show through its letters by two blends
 * (the stylesheet's `.letters-*` rules), so where blending isn't drawn,
 * or before the photos load, the letters are plain text.
 *
 * Without script the photos drift slowly across, and hold still for
 * reduced motion. With an `engine`, the client (src/client/lab.ts) draws
 * them in WebGL instead, as a fluid, as tiles on springs or under water,
 * stirred by the pointer anywhere over the word; the drifting photos are
 * where it takes them from, and what stays when it can't run.
 *
 * Any page can set any word this way: the word is the children, written
 * once and shown twice (the heading, and the solid copy that draws its
 * slash and cursor over the blend).
 */

/** A photo in the letters: a face takes one cell, a crowd four. */
export interface LetterTile {
  readonly photo: Rows.Photo;
  readonly big: boolean;
}

/** How a stage sets its photos moving, when its page runs the lab's script. */
export type LetterEngine = "fluid" | "springs" | "ripples";

/** The most tiles a stage sets, before it repeats them for its drift. */
export const letterTileLimit = 96;

/**
 * Faces only, or faces and crowds mixed: every crowd a big tile, then four
 * faces, while both last, then whichever is left.
 */
export function letterTiles(
  faces: ReadonlyArray<Rows.Photo>,
  crowds: ReadonlyArray<Rows.Photo>,
  mix: boolean,
): ReadonlyArray<LetterTile> {
  const small = faces.map((photo) => ({ photo, big: false }));
  if (!mix) return small.slice(0, letterTileLimit);
  const big = crowds.map((photo) => ({ photo, big: true }));
  const tiles: Array<LetterTile> = [];
  while (
    (small.length > 0 || big.length > 0) &&
    tiles.length < letterTileLimit
  ) {
    for (const next of [big.shift(), ...small.splice(0, 4)]) {
      if (next !== undefined && tiles.length < letterTileLimit)
        tiles.push(next);
    }
  }
  return tiles;
}

export interface LetterStageProps {
  /** The heading's id, which its section is labelled by. */
  readonly id: string;
  readonly tiles: ReadonlyArray<LetterTile>;
  readonly images: ImageMode;
  readonly engine?: LetterEngine | undefined;
}

export function LetterStage({
  id,
  tiles,
  images,
  engine,
  children,
}: PropsWithChildren<LetterStageProps>) {
  const shown = tiles.filter((tile) => hasSource(tile.photo, images));
  // A face is a portrait, cropped square; a crowd keeps its width
  // variants and is cropped to its cell by the stylesheet.
  const items = shown.map((tile, index) => {
    const loading = {
      first: index < 4 ? true : undefined,
      eager: index < 24 ? true : undefined,
    } as const;
    return tile.big ? (
      <li class="letters-big">
        <Photo
          photo={decorative(tile.photo)}
          mode={images}
          sizes="144px"
          widest={480}
          {...loading}
        />
      </li>
    ) : (
      <li>
        <SquarePhoto
          photo={tile.photo}
          mode={images}
          side={72}
          sides={[72, 144]}
          alt=""
          {...loading}
        />
      </li>
    );
  });
  return (
    <div
      class="letters"
      data-engine-stage={engine === undefined ? undefined : ""}
    >
      {items.length === 0 ? (
        ""
      ) : (
        <div class="letters-photos" aria-hidden="true" data-engine={engine}>
          <div class="letters-track">
            <ul data-engine-tiles="">{items}</ul>
            {/* The same tiles again, so the drift loops without a seam. */}
            <ul>{items}</ul>
          </div>
        </div>
      )}
      <h1 id={id} class="letters-word">
        {children}
      </h1>
      {/* The slash and the cursor, solid, over the letters' blend. */}
      <p class="letters-word letters-ink" aria-hidden="true">
        {children}
      </p>
    </div>
  );
}
