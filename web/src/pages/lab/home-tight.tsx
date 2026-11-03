import { Tally } from "../figures.tsx";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import type { ImageMode } from "../picture.tsx";
import { DatedGrid, datedEvenings } from "../slash-grid.tsx";
import type { LabData } from "./lab.tsx";

/**
 * home-tight: home that fits a MacBook's screen, footer aside: 1440×900,
 * 1512×982 and 1728×1117 fullscreen, and those windowed, about 80 pixels
 * shorter. It is home (home.tsx) with two changes:
 *
 * - The dated grid holds the latest {@link tightCount} evenings, three
 *   rows of six, each cut 4:3 instead of 4:5, and stands at the top of
 *   the hero rather than filling its height.
 * - The tally leaves its own band: it opens the two sentences' column of
 *   the band below, a compact row of four figures in the space the
 *   statement left above itself.
 *
 * Nothing else changes: the lockup, its size, the lists, the tokens.
 */

/** The evenings the grid shows: three rows of six. */
export const tightCount = 18;

/**
 * The variant's page: the hero beside the latest {@link tightCount}
 * evenings' cuts, or the hero alone when none has a photo, then home's
 * band with the compact tally at the top of its first column.
 */
export function HomeTight({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const evenings = datedEvenings(community.evenings, images, tightCount);
  return (
    <div class="lab-home tight">
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
          <DatedGrid evenings={evenings} images={images} />
        )}
      </section>
      <HomeBand home={home}>
        <Tally tally={community.tally} kind="compact" />
      </HomeBand>
    </div>
  );
}
