import type { DateTime } from "effect";
import { sfDay } from "./readiness/calendar.ts";

/**
 * Evenings that wear another organization's cover, in one place.
 *
 * An evening's Luma cover is allthings' own, in the Swiss Index layout
 * (src/cover.ts, brand/marks/cover.py). The one exception is an evening a
 * conference's organizers made an official community event of theirs and
 * let wear their branding: its cover is their cover's art, with our lockup,
 * its day and its place set on it, still drawn from its facts by the
 * brand's template, never by hand.
 *
 * Which evenings those are is decided here and only here: a co-brand claims
 * the evening with its topic on one of its days, nothing else. Its facts
 * then say so (CoverFacts' `cobrand`), so its approval token covers which
 * template draws it; every other evening's facts, and tokens, are as they
 * were. The art itself and how it is drawn are in brand/marks
 * (summit_cover.py), keyed by the co-brand's id.
 */

export interface Cobrand {
  /** The template brand/marks/cover.py draws its covers with. */
  readonly id: "aie-code-summit";
  /** As copy names it. */
  readonly name: string;
  /** The topic of the evening it claims: allthings/<topic>. */
  readonly topic: string;
  /**
   * The San Francisco days (YYYY-MM-DD, both included) its branding may be
   * worn on: the conference's own, as its organizers allowed.
   */
  readonly from: string;
  readonly to: string;
  /** Who allowed it, and what, for reviewers. */
  readonly allowed: string;
}

/**
 * AI Engineer's Code Summit in San Francisco, November 9 to 12, 2026:
 * allthings/aie is one of its official community events.
 */
export const aieCodeSummit: Cobrand = {
  id: "aie-code-summit",
  name: "AI Engineer Code Summit",
  topic: "aie",
  from: "2026-11-09",
  to: "2026-11-12",
  allowed:
    "AIE's organizers (G2i) confirmed to Erik that community events during the Code Summit may use its branding, and supplied the cover art.",
};

export const cobrands: ReadonlyArray<Cobrand> = [aieCodeSummit];

/**
 * The co-brand the evening with `topic` starting at `startsAt` wears, if
 * any: the one with its topic whose days it falls on, in San Francisco.
 */
export function cobrandOf(evening: {
  readonly topic: string | null | undefined;
  readonly startsAt: DateTime.DateTime;
}): Cobrand | undefined {
  const day = sfDay(evening.startsAt);
  return cobrands.find(
    (cobrand) =>
      cobrand.topic === evening.topic &&
      cobrand.from <= day &&
      day <= cobrand.to,
  );
}
