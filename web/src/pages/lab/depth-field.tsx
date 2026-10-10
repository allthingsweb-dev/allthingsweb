import { count } from "../about.tsx";
import { HomeBand } from "../home.tsx";
import { type ImageMode, Photo, showable } from "../picture.tsx";
import { decorative, type LabData, NextEvening, screenShare } from "./lab.tsx";

/**
 * depth-field: after localfirstconf.com's 2027 page. On Night, photos of
 * the evenings hang at different sizes and depths around one statement
 * made of real numbers, drifting slowly in a 3D field that sways, so the
 * near ones pass the far ones. The next evening sits under the statement.
 */

/** The field's photos: twelve places around the statement. */
export const fieldCount = 12;

/**
 * The statement, from the tally: how many people said "I'm in", and over
 * how many evenings. Without guests counted, the evenings alone.
 */
export function statement(tally: {
  readonly guests: number;
  readonly evenings: number;
}): { readonly lead: string; readonly after: string } {
  const evenings = `${count(tally.evenings)} ${tally.evenings === 1 ? "evening" : "evenings"}`;
  return tally.guests > 0
    ? {
        lead: `${count(tally.guests)} people said “I’m in.”`,
        after: `${evenings}, in the neighborhoods of San Francisco.`,
      }
    : {
        lead: `${evenings} for people who build software.`,
        after: "In the neighborhoods of San Francisco.",
      };
}

export function DepthField({
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
