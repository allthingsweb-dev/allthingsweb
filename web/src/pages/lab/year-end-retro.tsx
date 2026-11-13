import { HomeBand } from "../home.tsx";
import { type ImageMode, Photo, showable } from "../picture.tsx";
import { fieldCount, statement } from "../year.tsx";
import { decorative, type LabData, NextEvening, screenShare } from "./lab.tsx";

/**
 * year-end-retro: saved from the home lab's first round, where it was
 * depth-field, and now the hero of a year's page (pages/year.tsx), whose
 * statement and field it shares. On Night, photos of the evenings hang at
 * different sizes and depths around one statement made of the real
 * numbers, drifting slowly in a 3D field that sways, so the near ones pass
 * the far ones.
 */

export { fieldCount, statement };

export function YearEndRetro({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const photos = community.wall
    .filter(({ photo }) => showable([photo], images).length > 0)
    .slice(0, fieldCount);
  const { lead, after } = statement(community.tally);
  return (
    <div class="lab-home">
      <section
        class="depth bleed"
        data-theme="dark"
        aria-labelledby="depth-statement"
      >
        <div class="depth-field" aria-hidden="true">
          <div class="depth-sway">
            {photos.map(({ photo }) => (
              <div class="depth-photo">
                <div class="depth-drift">
                  <Photo
                    photo={decorative(photo)}
                    mode={images}
                    sizes={screenShare(22, 26)}
                    widest={720}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div class="depth-text">
          <h1 id="depth-statement" class="depth-statement">
            <span safe>{lead}</span>
            <span class="depth-after" safe>
              {after}
            </span>
          </h1>
          <NextEvening next={home.next} />
        </div>
      </section>
      <HomeBand home={home} />
    </div>
  );
}
