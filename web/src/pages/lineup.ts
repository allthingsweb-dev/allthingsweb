import type { Talk } from "allthings-core/src/event-page.ts";

/**
 * How much an event page says about each talk and its people, by how many
 * talks the evening had. The rules live here alone; event.tsx draws them.
 *
 * - "cards": up to `cardsUpTo` talks. A plain talk shows each of its
 *   speakers in full: a large portrait, their title, links and bio.
 * - "rows": up to `rowsUpTo` talks. Each talk shows its people as rows of
 *   portrait, role, name and title; their bios are on /people.
 * - "list": more than `rowsUpTo` talks, as in a lightning round. One compact
 *   row per talk: small portraits, its title, its speakers, and its
 *   description behind a disclosure.
 *
 * A panel or a fireside chat, or a talk with more than `cardsUpTo` people,
 * shows its people as rows even among few talks: several people at once
 * read as a group, not as a stack of bios.
 */
export const cardsUpTo = 3;
export const rowsUpTo = 6;

export type LineupDensity = "cards" | "rows" | "list";

/** The density of an evening's lineup of `talks`. */
export const lineupDensity = (talks: number): LineupDensity =>
  talks <= cardsUpTo ? "cards" : talks <= rowsUpTo ? "rows" : "list";

/** How a talk shows its people on an evening whose lineup is `density`. */
export const talkPeople = (
  talk: Pick<Talk, "format" | "speakers">,
  density: Exclude<LineupDensity, "list">,
): "cards" | "rows" =>
  density === "cards" &&
  talk.format === "talk" &&
  talk.speakers.length <= cardsUpTo
    ? "cards"
    : "rows";
