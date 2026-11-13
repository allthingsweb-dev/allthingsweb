import type {
  GuideListing,
  StarGroup,
  Stars,
} from "allthings-core/src/guide.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { guidePath } from "../links.ts";
import { ogCards } from "../og/cards.ts";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import type { Theme } from "./theme.ts";
import { simpleDays } from "./time.ts";

/**
 * /guide: the allthings guide (core's src/guide.ts), happenings beyond our
 * evenings worth going to, starred the way the Michelin guide stars a restaurant.
 * Three stars first, each count under what it means, then each happening:
 * its name, where it is and its next edition's days (or that they aren't
 * announced yet), why it's worth the journey, then who runs it and its own
 * site, in quiet lines of words as the footer's socials are. Each has an
 * anchor, /guide#<id>, for the API and the tools to link to.
 *
 * Like /talks, it stays out of the header, which has no room for a fifth
 * section at 320 pixels; the evenings index links here under its title.
 */

export interface GuideProps {
  readonly groups: ReadonlyArray<StarGroup>;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/** "three stars", as a screen reader says a count of them. */
export const starsSaid: Readonly<Record<Stars, string>> = {
  3: "three stars",
  2: "two stars",
  1: "one star",
};

/** ★★★: the stars themselves, which a screen reader skips for their words. */
export const starMarks = (stars: Stars): string => "★".repeat(stars);

/** One happening in the guide. */
function Entry({ entry }: { readonly entry: GuideListing }) {
  return (
    <li class="guide-entry" id={entry.id}>
      <h3 class="at-type-list-name" safe>
        {entry.name}
      </h3>
      <ul class="socials at-type-meta">
        <li safe>{entry.city}</li>
        <li>
          {entry.next === null ? (
            "dates not announced yet"
          ) : (
            <time datetime={entry.next.from} safe>
              {simpleDays(entry.next.from, entry.next.to)}
            </time>
          )}
        </li>
      </ul>
      <p safe>{entry.why}</p>
      <ul class="socials at-type-meta">
        <li safe>{`by ${entry.organizer}`}</li>
        <li>
          <a href={entry.url} safe>
            {siteName(entry.url)}
          </a>
        </li>
      </ul>
    </li>
  );
}

/** "reactmiami.com": a site's address as people say it, its host without www. */
export const siteName = (url: string): string =>
  new URL(url).hostname.replace(/^www\./, "");

/** The whole guide, in the visitor's mode. */
export function guidePage({
  groups,
  origin,
  theme,
  portraits,
  images,
}: GuideProps): string {
  return Document({
    section: "events",
    meta: {
      title: gatheringTitle("the guide"),
      description:
        "Happenings worth the trip, starred the way the Michelin guide stars a restaurant: three stars are worth a special journey, two a detour, one a stop.",
      path: guidePath,
      image: ogCards.guide,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="evenings">
        <div class="evenings-head">
          <h1 class="lockup at-type-event-lockup">the guide</h1>
          <p class="lead at-type-lead">
            Happenings worth the trip, starred the way the Michelin guide stars
            a restaurant.
          </p>
          <p>
            Three stars are worth a special journey, two a detour, one a stop.
          </p>
          <p>
            We star what we would go to ourselves, for the people, the talks and
            what gets built there. The stars are our call, never a count or a
            vote.
          </p>
        </div>
        <div class="evenings-lists">
          {groups.map((group) => (
            <section class="list" aria-labelledby={`stars-${group.stars}`}>
              <div class="list-head">
                <h2 id={`stars-${group.stars}`} class="list-title at-type-meta">
                  <span aria-hidden="true" safe>
                    {starMarks(group.stars)}
                  </span>{" "}
                  <span class="visually-hidden" safe>
                    {`${starsSaid[group.stars]}: `}
                  </span>
                  <span safe>{group.meaning}</span>
                </h2>
                <p class="list-links" safe>
                  {group.advice}
                </p>
              </div>
              <ol class="talks">
                {group.entries.map((entry) => (
                  <Entry entry={entry} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    ),
  });
}
