import { HomeParts } from "../home.tsx";
import type { ImageMode } from "../picture.tsx";
import type { LabData } from "./lab.tsx";

/**
 * slash-grid: a grid of the community's photos, each cut on the slash's
 * own slant and leading to its evening, beside the lockup on the page's
 * grid; under them, the tally as a band of numbers, a column of the grid
 * to each. Home took it (home.tsx, slash-grid.tsx): this is home, in the
 * lab's frame, to compare the others with.
 */
export function SlashGrid({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  return (
    <div class="lab-home">
      <HomeParts home={home} community={community} images={images} />
    </div>
  );
}
