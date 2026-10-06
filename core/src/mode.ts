import { DateTime } from "effect";

/**
 * An event's artwork has one mode (brand/foundations.md, "Color"): evening
 * events are Night, daytime events (hackathons, brunches) are Paper, and an
 * event's cover, link-preview card, slides and posts share it. Its page
 * does not: every page is in the visitor's mode. Which one an event is
 * follows from when it starts on San Francisco's wall clock, by one rule:
 *
 * An event that starts from 5 AM up to 4 PM is a daytime event, Paper.
 * One that starts at 4 PM or later, or in the small hours, is an evening,
 * Night.
 *
 * Our evenings start at 5 or 5:30 PM and hackathons in the morning, so the
 * line falls between them; an event that starts at 4 PM is still the
 * afternoon's crowd heading into the evening.
 */

/** The two modes, as brand/src/tokens.ts names them. */
export type EventMode = "paper" | "night";

/** Where every evening happens. */
const sanFrancisco = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles");

/** The first hour of the day that is daytime: 5 AM. */
export const daytimeStartsAt = 5;
/** The first hour of the evening: 4 PM. */
export const eveningStartsAt = 16;

/** The mode of an event that starts at `startsAt`. */
export function eventMode(startsAt: DateTime.DateTime): EventMode {
  const { hour } = DateTime.toParts(DateTime.setZone(startsAt, sanFrancisco));
  return hour >= daytimeStartsAt && hour < eveningStartsAt ? "paper" : "night";
}
