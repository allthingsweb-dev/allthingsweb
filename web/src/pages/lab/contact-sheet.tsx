import type { WallPhoto } from "allthings-core/src/community.ts";
import { DateTime } from "effect";
import { eventPath } from "../../links.ts";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import { type ImageMode, Photo, showable } from "../picture.tsx";
import { listDate, year } from "../time.ts";
import { type LabData, screenShare, Tally } from "./lab.tsx";

/**
 * contact-sheet: today's Swiss index, with the photos beside the hero as
 * a photographer's contact sheet: thirty-six small frames from many
 * evenings, each captioned with its evening's date and leading to it, read
 * like an archive. Under it, the tally as a bold band of numbers.
 */

/** The sheet's frames: six rows of six. */
export const frameCount = 36;

/** "From 18 evenings, 2024–2026": what the sheet holds, counted. */
export function sheetCaption(frames: ReadonlyArray<WallPhoto>): string {
  const evenings = new Set(frames.map((frame) => frame.slug)).size;
  const years = frames.map((frame) => year(frame.startsAt));
  const [first, last] = [Math.min(...years), Math.max(...years)];
  const span = first === last ? `${first}` : `${first}–${last}`;
  return `From ${evenings} ${evenings === 1 ? "evening" : "evenings"}, ${span}`;
}

function Frame({
  frame,
  images,
}: {
  readonly frame: WallPhoto;
  readonly images: ImageMode;
}) {
  return (
    <li>
      <a class="frame" href={eventPath(frame.slug)}>
        <Photo
          photo={frame.photo}
          mode={images}
          sizes={screenShare(6, 23)}
          widest={360}
        />
        <time
          class="frame-date at-type-meta"
          datetime={DateTime.formatIso(frame.startsAt)}
          safe
        >
          {listDate(frame.startsAt)}
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
  const frames = community.wall
    .filter(({ photo }) => showable([photo], images).length > 0)
    .slice(0, frameCount);
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
              {frames.map((frame) => (
                <Frame frame={frame} images={images} />
              ))}
            </ol>
            <figcaption class="at-type-meta" safe>
              {sheetCaption(frames)}
            </figcaption>
          </figure>
        )}
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </div>
  );
}
