import type { EveningsView } from "allthings-core/src/evenings.ts";
import type { Evening } from "allthings-core/src/home.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { discord, lumaCalendar, xHandle, yearPath } from "../links.ts";
import { yearTitle } from "./year.tsx";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import { EveningRow } from "./evening-row.tsx";
import type { Theme } from "./theme.ts";
import { year } from "./time.ts";
import { ogCards } from "../og/cards.ts";
import type { ImageMode } from "./picture.tsx";

/**
 * /events: every evening, in the rows home lists them in. The evenings
 * still ahead come first, soonest first and with the cursor; then every
 * evening that has happened, latest first, under the year it happened in.
 * Under the title, where to follow along, in a quiet line of words as the
 * footer's socials are (brand/foundations.md, "People and channels").
 * Each list labels its right-hand column, on its year's line: the places
 * are neighborhoods. Under a year that held one of ours, a link to that
 * year's page (pages/year.tsx).
 */

/** Where to follow every evening, in the line under /events' title. */
export const channels: ReadonlyArray<{
  readonly name: string;
  readonly href: string;
}> = [
  { name: "luma calendar", href: lumaCalendar },
  { name: "discord", href: discord },
  { name: "x", href: `https://x.com/${xHandle}` },
];

export interface EventsProps {
  readonly evenings: EveningsView;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

export interface YearOfEvenings {
  /** In San Francisco, where the evenings happen. */
  readonly year: number;
  readonly evenings: ReadonlyArray<Evening>;
}

/**
 * `evenings`, latest first, grouped by the year each happened in: the
 * latest year first, and each year's evenings in the order given.
 */
export function byYear(
  evenings: ReadonlyArray<Evening>,
): ReadonlyArray<YearOfEvenings> {
  const years: Array<{ year: number; evenings: Array<Evening> }> = [];
  for (const evening of evenings) {
    const when = year(evening.startsAt);
    const last = years.at(-1);
    if (last?.year === when) last.evenings.push(evening);
    else years.push({ year: when, evenings: [evening] });
  }
  return years;
}

/**
 * Whether a year's page has something to look back on: one of the
 * evenings that has happened in it is ours (core's src/year.ts holds
 * ours, held).
 */
export const heldOne = (past: ReadonlyArray<Evening>): boolean =>
  past.some((evening) => evening.curation.kind === "ours");

function EveningList({
  id,
  title,
  evenings,
  more,
}: {
  readonly id: string;
  readonly title: string;
  readonly evenings: ReadonlyArray<Evening>;
  /** A link under the list, to more about these evenings. */
  readonly more?: { readonly href: string; readonly text: string } | undefined;
}) {
  return (
    <section class="list" aria-labelledby={id}>
      <div class="list-head">
        <h2 id={id} class="list-title at-type-meta" safe>
          {title}
        </h2>
        {evenings.some((evening) => evening.neighborhood !== null) ? (
          // Each row names its neighborhood to a screen reader (evening-row.tsx).
          <p class="list-column at-type-meta" aria-hidden="true">
            Neighborhood
          </p>
        ) : (
          ""
        )}
      </div>
      <ol>
        {evenings.map((evening) => (
          <EveningRow evening={evening} />
        ))}
      </ol>
      {more === undefined ? (
        ""
      ) : (
        <p class="list-links list-foot">
          <a href={more.href}>
            <span safe>{more.text}</span> <span aria-hidden="true">→</span>
          </a>
        </p>
      )}
    </section>
  );
}

/** The whole evenings index for `evenings`, in the visitor's mode. */
export function eventsPage({
  evenings,
  origin,
  theme,
  portraits,
  images,
}: EventsProps): string {
  const { ahead, past } = evenings;
  return Document({
    section: "events",
    meta: {
      title: gatheringTitle("every evening"),
      description:
        "Every allthings evening, ahead and past. In the neighborhoods of San Francisco.",
      path: "/events",
      image: ogCards.events,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="evenings">
        <div class="evenings-head">
          <h1 class="lockup at-type-event-lockup">every evening</h1>
          <ul class="socials at-type-meta">
            {channels.map((channel) => (
              <li>
                <a href={channel.href} safe>
                  {channel.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div class="evenings-lists">
          {ahead.length === 0 ? (
            ""
          ) : (
            <EveningList id="upcoming" title="Upcoming" evenings={ahead} />
          )}
          {byYear(past).map(({ year: when, evenings: inYear }) => (
            <EveningList
              id={`evenings-${when}`}
              title={String(when)}
              evenings={inYear}
              more={
                heldOne(inYear)
                  ? { href: yearPath(when), text: yearTitle(when) }
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    ),
  });
}
