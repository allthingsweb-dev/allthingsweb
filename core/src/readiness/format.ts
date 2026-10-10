import { weekdayNames } from "./calendar.ts";
import type { ReadinessReport } from "./readiness.ts";

/** A readiness report as lines to read, for the CLI (scripts/readiness.ts). */
export function formatReadiness(report: ReadinessReport): string {
  const { subject, suggestions } = report;
  const blockers = report.checks.filter((check) => check.level === "blocker");
  const advice = report.checks.filter((check) => check.level === "advice");
  const lines = [
    subject.kind === "event"
      ? `${subject.name} (${subject.slug}), ${subject.day}, ${subject.program}${subject.isDraft ? ", draft" : ", public"}`
      : `idea: ${subject.title} (${subject.id}), ${subject.program}, no draft evening yet`,
    report.ready
      ? "✓ ready: nothing blocks publishing"
      : `✗ not ready: ${blockers.length} ${blockers.length === 1 ? "thing blocks" : "things block"} publishing`,
    ...blockers.map((check) => `  ✗ ${check.message}`),
    ...(advice.length === 0 ? [] : ["advice:"]),
    ...advice.map((check) => `  · ${check.message}`),
    "",
    `suggestions, matching: ${suggestions.terms.length === 0 ? "(no topic words)" : suggestions.terms.join(", ")}`,
  ];

  const { network, wanted, lineup } = suggestions.speakers;
  lines.push(
    `speakers${lineup ? "" : " (its program has no lineup)"}:`,
    ...(network.length === 0
      ? ["  none from the network share its words"]
      : []),
    ...network.map(
      (speaker) =>
        `  ${speaker.name}: ${speaker.matched.join(", ")} · ${speaker.talks} ${speaker.talks === 1 ? "talk" : "talks"}, last ${speaker.lastSpoke.slug}`,
    ),
    ...wanted.map(
      (speaker) =>
        `  wanted: ${speaker.name} [${speaker.status}]${speaker.freeThatDay ? "" : ", not free that day"}${speaker.matched.length === 0 ? "" : ` · ${speaker.matched.join(", ")}`}`,
    ),
  );

  const { prospects, quiet } = suggestions.hosts;
  lines.push(
    "hosts:",
    ...prospects.map(
      (host) =>
        `  prospect: ${host.name} [${host.status}]${host.lastHosted === null ? "" : `, last hosted ${host.lastHosted}`}`,
    ),
    ...quiet.map(
      (host) =>
        `  ${host.name}: last hosted ${host.lastHosted} (${host.daysSince} days), ${host.evenings}×${host.lastAddress === null ? "" : ` · ${host.lastAddress}`}`,
    ),
    ...(prospects.length === 0 && quiet.length === 0 ? ["  none"] : []),
  );

  const { dates } = suggestions;
  lines.push(
    `open dates ${dates.from} to ${dates.to}, on ${dates.weekdays.map((weekday) => weekdayNames[weekday]).join(", ") || "any day"}:`,
    ...(dates.days.length === 0 ? ["  none"] : []),
    ...dates.days.map(
      (date) =>
        `  ${date.day} ${weekdayNames[date.weekday]}${date.wantedFree === 0 ? "" : ` · ${date.wantedFree} wanted ${date.wantedFree === 1 ? "speaker" : "speakers"} free`}`,
    ),
  );

  const { inspiredBy } = suggestions.attendees;
  lines.push(
    inspiredBy === null
      ? "attendees: no guest lists are stored"
      : `attendees: no guest lists are stored; ${inspiredBy.slug} had ${inspiredBy.guests ?? "an unknown number of"} going on Luma`,
  );
  if (report.planning !== "read") {
    lines.push(
      "planning: not readable as this role, so no wanted speakers or prospects",
    );
  }
  if (report.planning === "read" && report.collaboration !== "read") {
    lines.push(
      "collaboration: not readable as this role (row security), so no advice on rounds, logistics or tasks: run it as the database owner for that",
    );
  }
  return lines.join("\n");
}
