import type { DescriptionsImport } from "./descriptions.ts";

/**
 * The description import's result as text for an organizer: what it would
 * write (or wrote), event by event: each description's start and length,
 * and its summary, before and after.
 */

/** "1 event", "2 events". */
const count = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A description's opening words and its length, on one line. */
const glimpse = (html: string | null): string => {
  if (html === null) return "none";
  // Only to show which description it is: tags go, entities stay.
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${JSON.stringify(text.length > 72 ? `${text.slice(0, 71)}…` : text)} (${html.length} chars)`;
};

export function formatDescriptions(result: DescriptionsImport): string {
  if (result._tag === "Skipped") return `Skipped: ${result.reason}.`;
  const lines = [
    `Asked Luma about ${count(result.asked, "published event")}; ${result.unavailable.length} not shown to us${
      result.unavailable.length === 0
        ? ""
        : `: ${result.unavailable.join(", ")}`
    }.`,
    result.written === null
      ? `Would change ${count(result.changes.length, "event")} (dry run: nothing written).`
      : `Wrote ${count(result.written, "event")}.`,
  ];
  for (const change of result.changes) {
    lines.push(``, `${change.slug} (${change.lumaEventId})`);
    if (change.before.html !== change.after.html) {
      lines.push(
        `  description: ${glimpse(change.before.html)}`,
        `             → ${glimpse(change.after.html)}`,
      );
    }
    if (change.before.summary !== change.after.summary) {
      lines.push(
        `  summary: ${JSON.stringify(change.before.summary)}`,
        `         → ${JSON.stringify(change.after.summary)}`,
      );
    }
  }
  return lines.join("\n");
}
