import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import { type ImageMode, Photo, showable } from "../picture.tsx";
import { decorative, type LabData, screenShare, Tally } from "./lab.tsx";

/**
 * depth-field: after localfirstconf.com's 2026 hero, whose glowing blob is
 * a fragment shader of metaballs chasing the pointer. Ours is a liquid of
 * light over Night: blobs drift and run together, a trail of them follows
 * the pointer or a finger, and inside they are lenses onto a wall of the
 * evenings' photos, bent at their edges, their rims glowing from Glow into
 * Lavender (src/client/engines/liquid.ts). The lockup and the tally sit on
 * the grid over it.
 *
 * Without script, and for reduced motion, the same wall shows dimmed under
 * Night, with three still lenses on it.
 */

/** The wall under the liquid: six across, three down. */
export const fieldCount = 18;

/** Which of the wall's photos the still lenses show. */
const lensPhotos = [3, 8, 13] as const;

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
  return (
    <div class="lab-home">
      <section
        class="liquid bleed"
        data-theme="dark"
        aria-labelledby="next"
        data-engine-stage=""
      >
        <div class="liquid-field" aria-hidden="true" data-engine="liquid">
          <ul class="liquid-wall" data-engine-tiles="">
            {photos.map(({ photo }, index) => (
              <li>
                <Photo
                  photo={decorative(photo)}
                  mode={images}
                  sizes={screenShare(17, 34)}
                  widest={480}
                  first={index < 6 ? true : undefined}
                  eager={true}
                />
              </li>
            ))}
          </ul>
          {lensPhotos.map((index, lens) => {
            const photo = photos[index]?.photo;
            return photo === undefined ? (
              ""
            ) : (
              <div class={`liquid-lens liquid-lens-${lens + 1}`}>
                <Photo
                  photo={decorative(photo)}
                  mode={images}
                  sizes={screenShare(26, 50)}
                  widest={720}
                  eager={true}
                />
              </div>
            );
          })}
        </div>
        <div class="liquid-text">
          <div class="hero-text">
            {home.next === undefined ? <OpenSlot /> : <Hero next={home.next} />}
          </div>
          <Tally
            tally={community.tally}
            kind="columns"
            which={["evenings", "guests", "speakers"]}
          />
        </div>
      </section>
      <HomeBand home={home} />
    </div>
  );
}
