import type { YearView } from "allthings-core/src/year.ts";
import { tallyFacts } from "../pages/figures.tsx";
import type { OgImage } from "../pages/metadata.tsx";
import { statement, yearTitle } from "../pages/year.tsx";
import {
  type CardFacts,
  cardHeight,
  cardVersion,
  cardWidth,
} from "./event-card.ts";

/**
 * A year's link-preview card, drawn as an evening's is (event-card.ts),
 * on Night's ground, from the year's own numbers:
 *
 *     2026 IN EVENINGS                             (meta)
 *
 *     2,852 people                                 (the lockup's place:
 *     said “I’m in.”                                the year's statement)
 *
 *     7 EVENINGS · 12 PEOPLE ON STAGE · 4 …    a/  (label: the rest of the tally)
 *
 * The statement is the year page's own (pages/year.tsx), and the label
 * names what it doesn't: every other number of the tally, none that is
 * zero. Evenings are Night (brand/foundations.md, "Imagery").
 */

/** What `view`'s card says. */
export function yearCardFacts(view: YearView): CardFacts {
  const { lead } = statement(view.tally, view.year);
  return {
    slug: `year/${view.year}`,
    mode: "night",
    topic: undefined,
    name: lead,
    ahead: false,
    when: yearTitle(view.year).toUpperCase(),
    // The statement says the guests, or, without them, the evenings.
    label: tallyFacts(
      view.tally,
      view.tally.guests > 0
        ? ["evenings", "speakers", "hostingCompanies"]
        : ["speakers", "hostingCompanies"],
    )
      .map(({ value, label }) => `${value} ${label}`)
      .join(" · ")
      .toUpperCase(),
  };
}

/** Where a year's card is: its own URL, stable, the one its page names. */
export const yearCardPath = (year: number): `/${string}` =>
  `/og/year/${year}.png`;

/**
 * `view`'s card as its page names it, with a version that changes when
 * what it says does, and what it says in words.
 */
export function yearCard(view: YearView): OgImage {
  const { lead, after } = statement(view.tally, view.year);
  return {
    src: `${yearCardPath(view.year)}?v=${cardVersion(yearCardFacts(view))}`,
    width: cardWidth,
    height: cardHeight,
    alt: `${yearTitle(view.year)} · allthings/_ · ${lead} ${after}`,
  };
}
