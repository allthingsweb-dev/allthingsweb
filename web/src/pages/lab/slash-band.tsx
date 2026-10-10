import type { WallPhoto } from "allthings-core/src/community.ts";
import { Hero, HomeBand, OpenSlot } from "../home.tsx";
import { type ImageMode, Photo, showable } from "../picture.tsx";
import { decorative, type LabData, Tally } from "./lab.tsx";

/**
 * slash-band: after localfirstconf.com's 2026 page, made of the brand. A
 * deep Night ground with the slash drawn huge behind the lockup as a neon
 * tube, Glow running into Bridge, its light slowly breathing; the tally
 * in columns under the lockup. Below, a band of photos drifting sideways,
 * each cut on the slash's own slant, under a mono label.
 */

/**
 * The slash of the master wordmark, as brand/marks draws it, moved to the
 * origin: 305 wide and 784 tall, leaning 14° (195.46 across for 784 up).
 */
const slashPath = "M0 784 195.46 0H304.88L109.42 784Z";

/** The room around the slash for its widest stroke, in the slash's units. */
const room = 16;

/**
 * The neon's layers, back to front: a wide wash of its light, the glow
 * around the tube, the tube itself, and its hot white core. Each is the
 * same slash in its own <svg>, drawn and blurred by lab.css.
 */
const layers = ["wash", "glow", "tube", "core"] as const;
type Layer = (typeof layers)[number];

/** One layer of the neon slash, its gradient (Glow into Bridge) its own. */
function NeonLayer({ layer }: { readonly layer: Layer }) {
  const gradient = `neon-${layer}-gradient`;
  const paint = `url(#${gradient})`;
  return (
    <svg
      class={`neon neon-${layer}`}
      viewBox={`${-room} ${-room} ${305 + 2 * room} ${784 + 2 * room}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop class="neon-glow-stop" offset="0" />
          <stop class="neon-bridge-stop" offset="1" />
        </linearGradient>
      </defs>
      <path
        d={slashPath}
        fill={layer === "wash" ? paint : "none"}
        stroke={layer === "wash" ? "none" : paint}
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** The band's photos: as many as the wall has, up to this many. */
export const bandCount = 14;

function Band({
  photos,
  images,
}: {
  readonly photos: ReadonlyArray<WallPhoto>;
  readonly images: ImageMode;
}) {
  const tiles = photos.map(({ photo }) => (
    <li>
      <Photo
        photo={decorative(photo)}
        mode={images}
        sizes="240px"
        widest={720}
      />
    </li>
  ));
  return (
    <section class="slash-band bleed" aria-labelledby="from-the-evenings">
      <h2 id="from-the-evenings" class="slash-band-title at-type-meta">
        From the evenings
      </h2>
      <div class="slash-band-view">
        <div class="slash-track">
          <ul>{tiles}</ul>
          {/* The same photos again, so the drift loops without a seam. */}
          <ul aria-hidden="true">{tiles}</ul>
        </div>
      </div>
    </section>
  );
}

export function SlashBand({
  data: { home, community },
  images,
}: {
  readonly data: LabData;
  readonly images: ImageMode;
}) {
  const photos = community.wall
    .filter(({ photo }) => showable([photo], images).length > 0)
    .slice(0, bandCount);
  return (
    <div class="lab-home">
      <section
        class="slash-hero bleed"
        data-theme="dark"
        aria-labelledby="next"
      >
        <div class="slash-light" aria-hidden="true">
          {layers.map((layer) => (
            <NeonLayer layer={layer} />
          ))}
        </div>
        <div class="slash-text">
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
      {photos.length === 0 ? "" : <Band photos={photos} images={images} />}
      <HomeBand home={home} />
    </div>
  );
}
