import type { HeldEvening } from "allthings-core/src/community.ts";
import { DateTime } from "effect";
import { eventPath, everyEvening } from "../../links.ts";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import { hasSource, type ImageMode, Photo } from "../picture.tsx";
import { simpleDate } from "../time.ts";
import { type LabData, screenShare, Tally } from "./lab.tsx";

/**
 * contact-sheet: today's Swiss index, with every evening we have held
 * beside the hero as a photographer's contact sheet: one frame each, in
 * the order they happened, captioned with its date and leading to it. It
 * holds the latest {@link frameLimit}, so a new evening always joins it and
 * the oldest leaves, and its last frame leads on to every evening. An
 * evening without a photo is its lockup, at/<topic>, in its frame. Under
 * it, the tally as a bold band of numbers.
 */

/** The sheet's frames: four across, seven down, less the one leading on. */
export const frameLimit = 27;

/** The frames a narrower screen shows: the latest, three across, less the one leading on. */
export const phoneFrames = 14;

function Frame({
  evening,
  early,
  images,
}: {
  readonly evening: HeldEvening;
  readonly early: boolean;
  readonly images: ImageMode;
}) {
  const { photo } = evening;
  return (
    <li class={early ? "frame-early" : undefined}>
      <a class="frame" href={eventPath(evening.slug)}>
        {photo !== null && hasSource(photo, images) ? (
          <Photo
            photo={photo}
            mode={images}
            sizes={screenShare(9, 30)}
            widest={360}
          />
        ) : (
          <span class="frame-blank">
            {evening.topic === undefined ? (
              <span safe>{evening.name}</span>
            ) : (
              <>
                at<span class="slash">/</span>
                <span safe>{evening.topic}</span>
              </>
            )}
          </span>
        )}
        <time
          class="frame-date at-type-meta"
          datetime={DateTime.formatIso(evening.startsAt)}
          safe
        >
          {simpleDate(evening.startsAt)}
        </time>
      </a>
    </li>
  );
}

export function ContactSheet({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  // The latest evenings, in the order they happened.
  const frames = community.evenings.slice(0, frameLimit).toReversed();
  const total = community.tally.evenings;
  return (
    <div class="lab-home">
      <section
        class={frames.length === 0 ? "hero" : "hero with-photos"}
        aria-labelledby="next"
      >
        <div class="hero-text">
          {home.next === undefined ? <OpenSlot /> : <Hero next={home.next} />}
        </div>
        {frames.length === 0 ? (
          ""
        ) : (
          <figure class="sheet">
            <ol>
              {frames.map((evening, index) => (
                <Frame
                  evening={evening}
                  early={index < frames.length - phoneFrames}
                  images={images}
                />
              ))}
              <li>
                <a class="frame frame-more" href={everyEvening}>
                  <span class="frame-blank">
                    every evening <span aria-hidden="true">→</span>
                  </span>
                  <span class="frame-date at-type-meta" safe>
                    {`all ${total}`}
                  </span>
                </a>
              </li>
            </ol>
            <figcaption class="at-type-meta" safe>
              {frames.length < total
                ? `The latest ${frames.length} of our ${total} evenings, in order`
                : `All ${total} of our evenings, in order`}
            </figcaption>
          </figure>
        )}
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </div>
  );
}
