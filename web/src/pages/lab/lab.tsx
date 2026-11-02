import type { PropsWithChildren } from "@kitajs/html";
import type { CommunityView } from "allthings-core/src/community.ts";
import type { Evening, HomeView } from "allthings-core/src/home.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { lumaCalendar } from "../../links.ts";
import { ogCards } from "../../og/cards.ts";
import { Document } from "../document.tsx";
import { Cursor } from "../evening-row.tsx";
import { ImIn, NextWhen, nextLabel } from "../home.tsx";
import { lockup } from "../metadata.tsx";
import type { ImageMode } from "../picture.tsx";
import type { Theme } from "../theme.ts";

/**
 * The home lab: experimental heroes for the home page, each a whole home
 * page at /lab/home/<variant>, the hero and then the rest of home below it
 * (home.tsx's HomeBand), from real data only: the next evening or the open
 * slot, the about page's tally, and the hand-picked photos and faces
 * (core's src/community.ts). The lab is for looking, not for finding: its
 * pages ask search engines to stay out, and nothing on the site links to
 * them, neither the header, the sitemap nor the feed.
 *
 * Every variant is server-rendered HTML, animated in CSS (src/styles/lab.css,
 * which only the lab's pages load) and still for people who prefer reduced
 * motion. The variants marked `scripted` are the site's one exception to
 * running no JavaScript: they load the lab's module (src/client/lab.ts),
 * which draws in WebGL with the pointer, and are whole without it.
 */

export { labPath, variantPath } from "./paths.ts";
export { Tally, tallyFacts } from "../figures.tsx";
export { screenShare } from "../picture.tsx";

/** What a variant is rendered from. */
export interface LabData {
  readonly home: HomeView;
  readonly community: CommunityView;
}

/** What every lab page is rendered for. */
export interface LabPage {
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/** A page of the lab around `children`: kept out of search, in the lab's frame. */
export function LabDocument({
  title,
  description,
  path,
  page,
  script,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly description: string;
  readonly path: `/${string}`;
  readonly page: LabPage;
  /** It runs the lab's script, for an engine. */
  readonly script?: true | undefined;
}>): string {
  return Document({
    meta: {
      title: lockup(title),
      description,
      path,
      image: ogCards.home,
      noindex: true,
    },
    origin: page.origin,
    theme: page.theme,
    portraits: page.portraits,
    images: page.images,
    lab: true,
    script,
    children,
  });
}

/** A photo of the wall without alt text: shown as texture, beside real text. */
export const decorative = <A extends { readonly alt: string }>(
  photo: A,
): A => ({
  ...photo,
  alt: "",
});

/**
 * The next evening, or the open slot, as a line under a hero that leads
 * with something else: when, the lockup as the page's second heading,
 * where and who hosts, and "I'm in". Under a hero that is the wordmark
 * already, the open slot leaves its lockup out (`slot: false`).
 */
export function NextEvening({
  next,
  slot = true,
}: {
  readonly next: Evening | undefined;
  readonly slot?: boolean;
}) {
  if (next === undefined) {
    return (
      <div class="lab-next">
        <p class="at-type-meta">Next · soon</p>
        {slot ? (
          <h2 id="next" class="lab-next-name">
            allthings<span class="slash">/</span>
            <Cursor />
          </h2>
        ) : (
          ""
        )}
        <p class="hero-label">San Francisco</p>
        <a class="button" href={lumaCalendar}>
          Subscribe on Luma <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  }
  const label = nextLabel(next);
  return (
    <div class="lab-next">
      <NextWhen next={next} />
      <h2 id="next" class="lab-next-name">
        {next.topic === undefined ? (
          <span safe>{next.name}</span>
        ) : (
          <>
            allthings<span class="slash">/</span>
            <span safe>{next.topic}</span>
          </>
        )}
        <Cursor />
      </h2>
      {label === "" ? (
        ""
      ) : (
        <p class="hero-label" safe>
          {label}
        </p>
      )}
      <ImIn next={next} />
    </div>
  );
}
