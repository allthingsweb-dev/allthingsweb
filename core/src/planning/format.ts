import type {
  Contact,
  HostProspect,
  Idea,
  Note,
  SearchHit,
  WantedSpeaker,
  Window,
} from "./model.ts";

/** Planning rows as lines to read, for the CLI (scripts/plan.ts). */

/** The day an instant falls on in San Francisco, where every evening is. */
const sfDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const day = (iso: string): string => sfDay.format(new Date(iso));

const event = (ref: { slug: string; startDate: string; isDraft: boolean }) =>
  `${ref.slug} (${day(ref.startDate)}${ref.isDraft ? ", draft" : ""})`;

const contactLine = (contact: Contact): string =>
  [
    contact.name,
    contact.company === null ? null : `at ${contact.company}`,
    contact.email,
    contact.url,
  ]
    .filter((part) => part !== null)
    .join(" · ");

const noteLines = (notes: ReadonlyArray<Note>): ReadonlyArray<string> =>
  notes.map(
    (note) =>
      `  note ${day(note.createdAt)}${note.author === null ? "" : ` (${note.author})`}: ${note.body}`,
  );

/** A window as it reads: "available from 2027-01-01 (free after Dec)". */
export function formatWindow(window: Window): string {
  const range =
    window.startsOn !== null && window.endsOn !== null
      ? `${window.startsOn} to ${window.endsOn}`
      : window.startsOn !== null
        ? `from ${window.startsOn}`
        : window.endsOn !== null
          ? `until ${window.endsOn}`
          : null;
  return [window.kind, range, window.note === null ? null : `(${window.note})`]
    .filter((part) => part !== null)
    .join(" ");
}

export function formatIdea(idea: Idea): string {
  return [
    `${idea.title} [${idea.status}] ${idea.id}`,
    `  ${idea.program}${idea.topic === null ? "" : ` · allthings/${idea.topic}`}`,
    `  ${idea.pitch}`,
    ...(idea.event === null ? [] : [`  event: ${event(idea.event)}`]),
    ...(idea.inspiredBy === null
      ? []
      : [`  builds on: ${event(idea.inspiredBy)}`]),
  ].join("\n");
}

export function formatSpeaker(speaker: WantedSpeaker): string {
  const who =
    speaker.person.kind === "profile"
      ? `${speaker.person.name} (profile ${speaker.person.profileId})`
      : `${contactLine(speaker.person.contact)} (contact ${speaker.person.contact.id})`;
  return [
    `${who} [${speaker.status}] ${speaker.id}`,
    `  topics: ${speaker.topics.join(", ")}`,
    ...speaker.availability.map(
      (window) => `  ${formatWindow(window)} ${window.id}`,
    ),
    ...(speaker.note === null ? [] : [`  ${speaker.note}`]),
    ...noteLines(speaker.notes),
  ].join("\n");
}

export function formatHost(host: HostProspect): string {
  const company =
    host.company.kind === "host"
      ? `${host.company.name} (host ${host.company.sponsorId})`
      : `${host.company.name} (new)`;
  return [
    `${company} [${host.status}] ${host.id}`,
    `  hosted ${host.timesHosted}×${host.lastHosted === null ? "" : `, last ${event(host.lastHosted)}`}`,
    ...(host.contact === null
      ? []
      : [`  contact: ${contactLine(host.contact)} (${host.contact.id})`]),
    ...(host.note === null ? [] : [`  ${host.note}`]),
    ...noteLines(host.notes),
  ].join("\n");
}

export function formatHits(hits: ReadonlyArray<SearchHit>): string {
  if (hits.length === 0) return "Nothing matches.";
  return hits
    .map((hit) => `${hit.kind}: ${hit.label} ${hit.id}\n  ${hit.text}`)
    .join("\n");
}

/** Rows as blocks, or a line saying there are none. */
export const formatAll = <A>(
  rows: ReadonlyArray<A>,
  format: (row: A) => string,
  none: string,
): string => (rows.length === 0 ? none : rows.map(format).join("\n\n"));
