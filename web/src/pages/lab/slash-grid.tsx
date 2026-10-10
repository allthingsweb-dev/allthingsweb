import type { WallPhoto } from "allthings-core/src/community.ts";
import { eventPath } from "../../links.ts";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import { type ImageMode, Photo, showable } from "../picture.tsx";
import { simpleDate } from "../time.ts";
import { type LabData, screenShare, Tally } from "./lab.tsx";

/**
 * slash-grid: a grid of the community's photos, each cut on the slash's
 * own slant (14°, as the wordmark draws it) and leading to its evening,
 * beside the lockup on the page's grid; under them, the tally as a band
 * of numbers, a column of the grid to each.
 */

/** The grid's photos: six across and four down on a wide screen. */
export const gridCount = 24;

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

export function SlashGrid({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const photos = community.wall
    .filter(({ photo }) => showable([photo], images).length > 0)
    .slice(0, gridCount);
  return (
    <div class="lab-home">
      <section
        class={photos.length === 0 ? "hero" : "hero slash-cut"}
        aria-labelledby="next"
      >
        <div class="hero-text">
          {home.next === undefined ? <OpenSlot /> : <Hero next={home.next} />}
        </div>
        {photos.length === 0 ? (
          ""
        ) : (
          <ul class="slash-grid">
            {photos.map((photo, index) => (
              <Cut photo={photo} index={index} images={images} />
            ))}
          </ul>
        )}
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </div>
  );
}
