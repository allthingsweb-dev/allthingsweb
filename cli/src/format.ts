import { styleText } from "node:util";
import type { Community, Event, EventSummary, Speaker } from "./schemas.ts";

type Style = Parameters<typeof styleText>[0];

export function createStyler(color: boolean) {
  return (style: Style, text: string) =>
    color ? styleText(style, text, { validateStream: false }) : text;
}

function formatWhere(event: EventSummary): string | null {
  return event.venue?.name ?? event.venue?.address ?? null;
}

/**
 * Event times are always shown in the event's own time zone, assembled from
 * parts so the output is identical across ICU versions.
 */
function withTimeZone(event: EventSummary): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: event.timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })
      .formatToParts(new Date(event.startsAt))
      .map((part) => [part.type, part.value]),
  );
  return `${parts["weekday"]}, ${parts["month"]} ${parts["day"]}, ${parts["year"]}, ${parts["hour"]}:${parts["minute"]} ${parts["dayPeriod"]} ${parts["timeZoneName"]}`;
}

export function formatEventList(
  events: EventSummary[],
  color: boolean,
): string {
  const style = createStyler(color);
  if (events.length === 0) return "No events found.\n";
  return (
    events
      .map((event) => {
        const status =
          event.status === "past"
            ? ""
            : ` ${style("yellow", `[${event.status}]`)}`;
        const where = formatWhere(event);
        return [
          `${style("bold", event.name)}${status}`,
          `  ${withTimeZone(event)}${where ? ` · ${where}` : ""}`,
          event.rsvpUrl && event.status !== "past"
            ? `  ${style("dim", "rsvp")}  ${event.rsvpUrl}`
            : null,
          `  ${style("dim", "slug")}  ${event.slug}`,
        ]
          .filter((line): line is string => line !== null)
          .join("\n");
      })
      .join("\n\n") + "\n"
  );
}

export function formatEvent(event: Event, color: boolean): string {
  const style = createStyler(color);
  const lines = [
    style("bold", event.name),
    event.tagline,
    "",
    `${style("dim", "when ")}  ${withTimeZone(event)}`,
  ];
  const where = [event.venue?.name, event.venue?.address]
    .filter((part): part is string => Boolean(part))
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(", ");
  if (where) lines.push(`${style("dim", "where")}  ${where}`);
  if (event.rsvpUrl) lines.push(`${style("dim", "rsvp ")}  ${event.rsvpUrl}`);
  if (event.recordingUrl) {
    lines.push(`${style("dim", "video")}  ${event.recordingUrl}`);
  }
  lines.push(`${style("dim", "page ")}  ${event.url}`);
  for (const talk of event.talks) {
    lines.push("", style("bold", talk.title));
    const speakers = talk.speakers
      .map((speaker) =>
        speaker.title ? `${speaker.name} (${speaker.title})` : speaker.name,
      )
      .join(", ");
    if (speakers) lines.push(speakers);
    if (talk.description) lines.push(style("dim", talk.description));
  }
  if (event.hosts.length > 0) {
    lines.push(
      "",
      `${style("dim", "hosted by")}  ${event.hosts.map((host) => host.name).join(", ")}`,
    );
  }
  return lines.join("\n") + "\n";
}

export function formatSpeakers(speakers: Speaker[], color: boolean): string {
  const style = createStyler(color);
  if (speakers.length === 0) return "No speakers found.\n";
  return (
    speakers
      .map((speaker) =>
        [
          speaker.title
            ? `${style("bold", speaker.name)} · ${speaker.title}`
            : style("bold", speaker.name),
          ...speaker.talks.map(
            (talk) => `  ${talk.title} ${style("dim", `(${talk.eventName})`)}`,
          ),
        ].join("\n"),
      )
      .join("\n\n") + "\n"
  );
}

export function formatCommunity(community: Community, color: boolean): string {
  const style = createStyler(color);
  return [
    style("bold", community.name),
    community.oneLiner,
    "",
    community.mission,
    "",
    `${style("dim", "events ")}  ${community.links.events}`,
    `${style("dim", "discord")}  ${community.links.discord}`,
    `${style("dim", "website")}  ${community.links.website}`,
    `${style("dim", "conduct")}  ${community.links.codeOfConduct}`,
    "",
  ].join("\n");
}
