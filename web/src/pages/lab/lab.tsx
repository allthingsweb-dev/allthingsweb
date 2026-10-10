import type { PropsWithChildren } from "@kitajs/html";
import { below } from "allthings-brand/src/layout.ts";
import type { Tally as TallyView } from "allthings-core/src/about.ts";
import type { CommunityView } from "allthings-core/src/community.ts";
import type { Evening, HomeView } from "allthings-core/src/home.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { lumaCalendar } from "../../links.ts";
import { ogCards } from "../../og/cards.ts";
import { count } from "../about.tsx";
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
 * Every variant is server-rendered HTML with no JavaScript, animated in CSS
 * alone (src/styles/lab.css, which only the lab's pages load), and still
 * for people who prefer reduced motion.
 */

export { labPath, variantPath } from "./paths.ts";

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
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly description: string;
  readonly path: `/${string}`;
  readonly page: LabPage;
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
    children,
  });
}

/** The `sizes` of a photo shown at `wide` of the screen, and `narrow` below `l`. */
export const screenShare = (wide: number, narrow: number): string =>
  `${below("l")} ${narrow}vw, ${wide}vw`;

/** A photo of the wall without alt text: shown as texture, beside real text. */
export const decorative = <A extends { readonly alt: string }>(
  photo: A,
): A => ({
  ...photo,
  alt: "",
});

/** The tally's numbers, each with what it counts; none that is zero. */
export function tallyFacts(
  tally: TallyView,
  which: ReadonlyArray<keyof TallyView> = [
    "evenings",
    "guests",
    "speakers",
    "hostingCompanies",
  ],
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  const labels: Record<keyof TallyView, string> = {
    evenings: "evenings",
    guests: "said “I’m in”",
    speakers: "people on stage",
    hostingCompanies: "hosting companies",
  };
  return which
    .filter((key) => tally[key] > 0)
    .map((key) => ({ value: count(tally[key]), label: labels[key] }));
}

/**
 * The tally as a row of big numbers over mono labels, as `kind` sets it:
 * a band under a hero, or columns within one.
 */
export function Tally({
  tally,
  kind,
  which,
}: {
  readonly tally: TallyView;
  readonly kind: "band" | "columns";
  readonly which?: ReadonlyArray<keyof TallyView>;
}) {
  const facts = tallyFacts(tally, which);
  if (facts.length === 0) return "";
  return (
    <section class={`lab-tally lab-tally-${kind}`} aria-label="So far">
      <dl>
        {facts.map(({ value, label }) => (
          <div>
            <dt class="at-type-meta" safe>
              {label}
            </dt>
            <dd safe>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

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
