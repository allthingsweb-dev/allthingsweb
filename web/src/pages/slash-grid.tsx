import type { WallPhoto } from "allthings-core/src/community.ts";
import { eventPath } from "../links.ts";
import { type ImageMode, Photo, screenShare, showable } from "./picture.tsx";
import { simpleDate } from "./time.ts";

/**
 * The slash grid: the community's photos (core's src/community.ts, the
 * hand-picked wall), each cut on the slash's own slant (14°, as the
 * wordmark draws it) and leading to its evening, beside the hero's lockup
 * on the page's grid. Home shows it (home.tsx), as the home lab's
 * slash-grid did first (pages/lab/).
 */

/** The grid's photos: six across and four down on a wide screen. */
export const gridCount = 24;

/** The wall's photos the grid shows: those it can, up to {@link gridCount}. */
export const gridPhotos = (
  wall: ReadonlyArray<WallPhoto>,
  images: ImageMode,
): ReadonlyArray<WallPhoto> =>
  wall
    .filter(({ photo }) => showable([photo], images).length > 0)
    .slice(0, gridCount);

function Cut({
  photo,
  index,
  images,
}: {
  readonly photo: WallPhoto;
  readonly index: number;
  readonly images: ImageMode;
}) {
  return (
    <li>
      <a href={eventPath(photo.slug)}>
        <Photo
          photo={photo.photo}
          mode={images}
          sizes={screenShare(10, 26)}
          widest={480}
          first={index < 6 ? true : undefined}
          eager={index < 12 ? true : undefined}
        />
        <span class="visually-hidden" safe>
          {`, ${simpleDate(photo.startsAt)}`}
        </span>
      </a>
    </li>
  );
}

/** The grid of `photos` (from {@link gridPhotos}), each cut on the slant. */
export function SlashGrid({
  photos,
  images,
}: {
  readonly photos: ReadonlyArray<WallPhoto>;
  readonly images: ImageMode;
}) {
  return (
    <ul class="slash-grid">
      {photos.map((photo, index) => (
        <Cut photo={photo} index={index} images={images} />
      ))}
    </ul>
  );
}
