import type { VenuesFill } from "./venues.ts";

/**
 * The venue fill's result as text for an organizer: each venue it would
 * write (or wrote), and every event still without one.
 */

/** "1 event", "2 events". */
const count = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

export function formatVenues(result: VenuesFill): string {
  if (result._tag === "Skipped") return `Skipped: ${result.reason}.`;
  const lines = [
    `Asked Luma about ${count(result.asked, "published event")} without a venue; ${result.unavailable.length} not shown to us${
      result.unavailable.length === 0
        ? ""
        : `: ${result.unavailable.join(", ")}`
    }.`,
    result.written === null
      ? `Would fill ${count(result.filled.length, "venue")} (dry run: nothing written).`
      : `Filled ${count(result.written, "venue")}.`,
    ...result.filled.map(
      (fill) =>
        `  ${fill.slug}: ${fill.venue.fullAddress}${fill.guestsOnly ? " (shown to guests only on Luma)" : ""}`,
    ),
  ];
  if (result.unplaced.length > 0) {
    lines.push(
      `Luma has no address for ${count(result.unplaced.length, "event")}:`,
      ...result.unplaced.map((slug) => `  ${slug}`),
    );
  }
  return lines.join("\n");
}
