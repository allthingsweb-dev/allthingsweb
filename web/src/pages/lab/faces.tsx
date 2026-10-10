import type { CommunityView } from "allthings-core/src/community.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { HomeBand } from "../home.tsx";
import { hasSource, type ImageMode, SquarePhoto } from "../picture.tsx";
import { type LabData, NextEvening, Tally } from "./lab.tsx";

/**
 * faces: the boldest. The wordmark across the page, its letters filled
 * with the community: a slowly moving mosaic of the faces of people who
 * have been on stage and the crowds of the evenings, seen only through
 * the letters. The heading is the real wordmark, as text; the photos
 * show through it by a blend (lab.css), so where blending isn't drawn the
 * letters are plain text on the ground. The slash stays solid.
 */

/** The mosaic's tiles: faces and crowds in turn, up to this many. */
export const mosaicCount = 88;

/**
 * Faces and crowds in turn, a face first: two faces to each crowd while
 * there are faces, so the letters read as people.
 */
export function mosaicOf(
  community: Pick<CommunityView, "faces" | "wall">,
): ReadonlyArray<Rows.Photo> {
  const faces = community.faces.map((face) => face.photo);
  const crowds = community.wall.map((photo) => photo.photo);
  const tiles: Array<Rows.Photo> = [];
  while (
    tiles.length < mosaicCount &&
    (faces.length > 0 || crowds.length > 0)
  ) {
    for (const next of [faces.shift(), faces.shift(), crowds.shift()]) {
      if (next !== undefined && tiles.length < mosaicCount) tiles.push(next);
    }
  }
  return tiles;
}

/** allthings/_, broken onto three lines where the stylesheet asks. */
function Word() {
  return (
    <>
      all
      <br class="faces-break" />
      things
      <br class="faces-break" />
      <span class="slash">/</span>
      <span class="at-cursor" aria-hidden="true">
        _
      </span>
    </>
  );
}

export function Faces({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const tiles = mosaicOf(community)
    .filter((photo) => hasSource(photo, images))
    .map((photo) => (
      <li>
        <SquarePhoto
          photo={photo}
          mode={images}
          side={72}
          sides={[72, 144]}
          alt=""
        />
      </li>
    ));
  return (
    <div class="lab-home">
      <section class="faces" aria-labelledby="faces-word">
        <div class="faces-stage">
          {tiles.length === 0 ? (
            ""
          ) : (
            <div class="faces-mosaic" aria-hidden="true">
              <div class="faces-track">
                <ul>{tiles}</ul>
                {/* The same tiles again, so the drift loops without a seam. */}
                <ul>{tiles}</ul>
              </div>
            </div>
          )}
          <h1 id="faces-word" class="faces-word">
            <Word />
          </h1>
          {/* The slash and the cursor, solid, over the letters' blend. */}
          <p class="faces-word faces-ink" aria-hidden="true">
            <Word />
          </p>
        </div>
        <NextEvening next={home.next} slot={false} />
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </div>
  );
}
