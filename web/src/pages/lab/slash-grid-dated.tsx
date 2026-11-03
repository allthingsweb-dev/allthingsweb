import { HomeParts } from "../home.tsx";
import type { ImageMode } from "../picture.tsx";
import type { LabData } from "./lab.tsx";

/**
 * slash-grid-dated: home's slash grid with one photo to each evening we
 * have held, the latest first, each cut on the slash's slant, leading to
 * its evening and dated under its cut. Home took it (home.tsx,
 * slash-grid.tsx): this is home, in the lab's frame, to compare the
 * others with.
 */
export function SlashGridDated({
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
