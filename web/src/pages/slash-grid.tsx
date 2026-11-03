import type { HeldEvening, WallPhoto } from "allthings-core/src/community.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { DateTime } from "effect";
import { eventPath } from "../links.ts";
import { type ImageMode, Photo, screenShare, showable } from "./picture.tsx";
import { simpleDate } from "./time.ts";

/**
 * The slash grid: the community's photos (core's src/community.ts), each
 * cut on the slash's own slant (14°, as the wordmark draws it) and leading
 * to its evening, beside the hero's lockup on the page's grid.
 *
 * Home shows it dated (home.tsx, {@link DatedGrid}): one photo to each
 * evening we have held, the latest first, its date under its cut, as the
 * home lab's slash-grid-dated did first. The home lab's slash-grid keeps
 * the first version ({@link SlashGrid}), the hand-picked wall undated.
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

/** An evening held, with the photo that stands for it. */
type Dated = HeldEvening & { readonly photo: Rows.Photo };

/** The evenings the grid shows, latest first: those with a photo it can show. */
export const datedEvenings = (
  evenings: ReadonlyArray<HeldEvening>,
  images: ImageMode,
): ReadonlyArray<Dated> =>
  evenings
    .filter(
      (evening): evening is Dated =>
        evening.photo !== null && showable([evening.photo], images).length > 0,
    )
    .slice(0, gridCount);

function DatedCut({
  evening,
  index,
  images,
}: {
  readonly evening: Dated;
  readonly index: number;
  readonly images: ImageMode;
}) {
  return (
    <li>
      <a href={eventPath(evening.slug)}>
        <span class="cut">
          <Photo
            photo={evening.photo}
            mode={images}
            sizes={screenShare(10, 26)}
            widest={480}
            first={index < 6 ? true : undefined}
            eager={index < 12 ? true : undefined}
          />
        </span>
        <time
          class="cut-date at-type-meta"
          datetime={DateTime.formatIso(evening.startsAt)}
          safe
        >
          {simpleDate(evening.startsAt)}
        </time>
      </a>
    </li>
  );
}

/** The dated grid of `evenings` (from {@link datedEvenings}). */
export function DatedGrid({
  evenings,
  images,
}: {
  readonly evenings: ReadonlyArray<Dated>;
  readonly images: ImageMode;
}) {
  return (
    <ul class="slash-grid slash-grid-dated">
      {evenings.map((evening, index) => (
        <DatedCut evening={evening} index={index} images={images} />
      ))}
    </ul>
  );
}
