import { DateTime } from "effect";
import {
  type EventCompleteness,
  type Gap,
  type GapKind,
  gapKinds,
  requiredGaps,
} from "./completeness.ts";
import { calendarTimeZone } from "./luma/feed.ts";

/**
 * The completeness report as an organizer reads it (a table of every event,
 * then each event's gaps) or as JSON for tools. Pure: the same reports give
 * the same text.
 */

/** The date an event starts in San Francisco, as YYYY-MM-DD. */
const localDate = (instant: DateTime.Utc): string => {
  const parts = DateTime.toParts(
    DateTime.makeZonedUnsafe(instant, { timeZone: calendarTimeZone }),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

/** Rows as a plain-text table, columns padded to their widest cell. */
function table(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  alignRight: ReadonlySet<number>,
): string {
  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: ReadonlyArray<string>) =>
    cells
      .map((cell, i) =>
        alignRight.has(i)
          ? cell.padStart(widths[i] ?? 0)
          : cell.padEnd(widths[i] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
  ].join("\n");
}

/** An event's gaps by kind, each kind with the talks, people or hosts it names. */
function gapLines(gaps: ReadonlyArray<Gap>): ReadonlyArray<string> {
  const byKind = Map.groupBy(gaps, (g) => g.kind);
  return (Object.keys(gapKinds) as Array<GapKind>).flatMap((kind) => {
    const found = byKind.get(kind);
    if (found === undefined) return [];
    const { label, required } = gapKinds[kind];
    const subjects = found.flatMap((g) =>
      g.subject === null ? [] : [g.subject],
    );
    return [
      `  ${required ? "-" : "~"} ${label}${subjects.length === 0 ? "" : `: ${subjects.join(", ")}`}`,
    ];
  });
}

/** Every event in a table, then each event's gaps. */
export function formatReport(
  reports: ReadonlyArray<EventCompleteness>,
): string {
  const summary = table(
    [
      "date",
      "status",
      "program",
      "event",
      "talks",
      "speakers",
      "people",
      "hosts",
      "photos",
      "guests",
      "gaps",
      "optional",
    ],
    reports.map((r) => {
      const required = requiredGaps(r).length;
      return [
        localDate(r.startDate),
        r.status,
        r.program,
        r.slug,
        String(r.talks),
        String(r.speakers),
        String(r.people),
        String(r.hosts),
        String(r.photos),
        r.guests === null ? "-" : String(r.guests),
        String(required),
        String(r.gaps.length - required),
      ];
    }),
    new Set([4, 5, 6, 7, 8, 9, 10, 11]),
  );
  const complete = reports.filter((r) => requiredGaps(r).length === 0).length;
  const details = reports
    .filter((r) => r.gaps.length > 0)
    .flatMap((r) => [
      "",
      `${localDate(r.startDate)} ${r.name} (${r.slug})`,
      ...gapLines(r.gaps),
    ]);
  return [
    summary,
    "",
    `${complete} of ${reports.length} published events lack nothing required. "-" is required, "~" optional.`,
    ...details,
  ].join("\n");
}

/** The reports as JSON-ready data, instants as ISO 8601. */
export const reportJson = (reports: ReadonlyArray<EventCompleteness>) =>
  reports.map((r) => ({
    ...r,
    startDate: DateTime.formatIso(r.startDate),
    endDate: DateTime.formatIso(r.endDate),
    gaps: r.gaps.map((g) => ({
      ...g,
      required: gapKinds[g.kind].required,
    })),
  }));
