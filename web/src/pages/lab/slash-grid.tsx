import { Tally } from "../figures.tsx";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import type { ImageMode } from "../picture.tsx";
import { gridPhotos, SlashGrid as Grid } from "../slash-grid.tsx";
import type { LabData } from "./lab.tsx";

/**
 * slash-grid: the first slash grid, home's from #293 until it was dated:
 * the community's hand-picked wall (core's src/community.ts), each photo
 * cut on the slash's slant and leading to its evening, undated, beside the
 * lockup; under them, the tally as a band of numbers.
 */
export function SlashGrid({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const photos = gridPhotos(community.wall, images);
  return (
    <div class="lab-home">
      <section
        class={photos.length === 0 ? "hero" : "hero slash-cut"}
        aria-labelledby="next"
      >
        <div class="hero-text">
          {home.next === undefined ? <OpenSlot /> : <Hero next={home.next} />}
        </div>
        {photos.length === 0 ? "" : <Grid photos={photos} images={images} />}
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </div>
  );
}
