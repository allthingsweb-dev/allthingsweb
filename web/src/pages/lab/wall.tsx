import type { WallPhoto } from "allthings-core/src/community.ts";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import { type ImageMode, Photo, showable } from "../picture.tsx";
import { eventPath } from "../../links.ts";
import { simpleDate } from "../time.ts";
import { type LabData, screenShare, Tally } from "./lab.tsx";

/**
 * wall: the old site's idea, done right. A full-bleed wall of crowds from
 * many evenings, dimmed under Night, each tile slowly crossing to another
 * photo in place, every photo leading to its evening and lighting up under
 * the pointer; on it the next evening and "I'm in". Under it, the tally as
 * big numbers.
 */

/** The wall's tiles at their most: seven across, three down. */
export const wallTiles = 21;

/**
 * The wall's photos as tiles of one or two: the first photos each start a
 * tile, and as many of the rest as there are tiles cross into them. The
 * stylesheet shows 21 tiles on wide screens and 15 on phones; the photos
 * it hides aren't loaded.
 */
export function tilesOf<A>(
  photos: ReadonlyArray<A>,
): ReadonlyArray<readonly [A, ...Array<A>]> {
  const count = Math.min(wallTiles, Math.ceil(photos.length / 2));
  return photos.slice(0, count).map((first, index) => {
    const second = photos[index + count];
    return second === undefined ? [first] : [first, second];
  });
}

/**
 * A tile of the wall: each of its photos leads to its evening. The one
 * crossing in takes the clicks only while it shows (lab.css).
 */
function Tile({
  photos,
  index,
  images,
}: {
  readonly photos: ReadonlyArray<WallPhoto>;
  readonly index: number;
  readonly images: ImageMode;
}) {
  return (
    <div class="wall-tile">
      {photos.map(({ photo, slug, startsAt }, layer) => (
        <a href={eventPath(slug)}>
          <Photo
            photo={photo}
            mode={images}
            sizes={screenShare(15, 34)}
            widest={480}
            first={layer === 0 && index < 7 ? true : undefined}
            eager={layer === 0 ? true : undefined}
            last={layer === 0 ? undefined : true}
          />
          <span class="visually-hidden" safe>
            {`, ${simpleDate(startsAt)}`}
          </span>
        </a>
      ))}
    </div>
  );
}

export function Wall({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const wall = community.wall.filter(
    ({ photo }) => showable([photo], images).length > 0,
  );
  return (
    <div class="lab-home">
      <section class="wall bleed" data-theme="dark" aria-labelledby="next">
        <div class="wall-text">
          <div class="hero-text">
            {home.next === undefined ? <OpenSlot /> : <Hero next={home.next} />}
          </div>
        </div>
        <div class="wall-photos">
          {tilesOf(wall).map((photos, index) => (
            <Tile photos={photos} index={index} images={images} />
          ))}
        </div>
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </div>
  );
}
