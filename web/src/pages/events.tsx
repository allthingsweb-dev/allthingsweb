import type { EveningsView } from "allthings-core/src/evenings.ts";
import type { Evening } from "allthings-core/src/home.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { discord, lumaCalendar } from "../links.ts";
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
 * Beside them, the two actions the foundations give Luma and Discord
 * ("People and channels").
 */

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

function EveningList({
  id,
  title,
  evenings,
}: {
  readonly id: string;
  readonly title: string;
  readonly evenings: ReadonlyArray<Evening>;
}) {
  return (
    <section class="list" aria-labelledby={id}>
      <div class="list-head">
        <h2 id={id} class="list-title at-type-meta" safe>
          {title}
        </h2>
      </div>
      <ol>
        {evenings.map((evening) => (
          <EveningRow evening={evening} />
        ))}
      </ol>
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
        "Every all things evening, ahead and past. In the neighborhoods of San Francisco.",
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
          <p class="list-links">
            <a href={lumaCalendar}>subscribe on luma</a>
            {" · "}
            <a href={discord}>
              talk between evenings <span aria-hidden="true">→</span> discord
            </a>
          </p>
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
            />
          ))}
        </div>
      </div>
    ),
  });
}
