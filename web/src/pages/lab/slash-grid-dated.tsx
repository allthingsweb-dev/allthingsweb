import type { HeldEvening } from "allthings-core/src/community.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { DateTime } from "effect";
import { eventPath } from "../../links.ts";
import { Tally } from "../figures.tsx";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import { type ImageMode, Photo, screenShare, showable } from "../picture.tsx";
import { gridCount } from "../slash-grid.tsx";
import { simpleDate } from "../time.ts";
import type { LabData } from "./lab.tsx";

/**
 * slash-grid-dated: home's slash grid (slash-grid.tsx), one photo to each
 * evening we have held instead of the hand-picked wall: the latest first,
 * each cut on the slash's slant, leading to its evening and dated under
 * its cut in the one way the site writes a day, 2026.09.30. An evening
 * without a photo here is left out, so the grid stays photos.
 */

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

export function SlashGridDated({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const evenings = datedEvenings(community.evenings, images);
  return (
    <div class="lab-home">
      <section
        class={evenings.length === 0 ? "hero" : "hero slash-cut"}
        aria-labelledby="next"
      >
        <div class="hero-text">
          {home.next === undefined ? <OpenSlot /> : <Hero next={home.next} />}
        </div>
        {evenings.length === 0 ? (
          ""
        ) : (
          <ul class="slash-grid slash-grid-dated">
            {evenings.map((evening, index) => (
              <DatedCut evening={evening} index={index} images={images} />
            ))}
          </ul>
        )}
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </div>
  );
}
