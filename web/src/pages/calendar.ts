import type { EventPage } from "allthings-core/src/event-page.ts";
import { eventPathOf, eventUrl } from "allthings-core/src/mappers.ts";
import { DateTime } from "effect";

/**
 * "Add to calendar": an event as an iCalendar file (RFC 5545), built from
 * the event's record alone, so the same record always gives the same file.
 * Its title is the sign-off, see you at/<topic> (brand/foundations.md,
 * "Name"), or the name as written when there is no topic.
 */

/** Where the evening's page is, under the calendar's own name for it. */
export const calendarPath = (slug: string): `/${string}` =>
  `${eventPathOf(slug)}/calendar.ics`;

/** Who made the file, as RFC 5545 asks: a name no other product uses. */
const productId = "-//all things//event page//EN";

/** Ids are unique to the event, under the site's domain. */
const uidDomain = "allthings.dev";

/** "20261001T003000Z": an instant in UTC, as iCalendar writes it. */
export function icsInstant(instant: DateTime.DateTime): string {
  return DateTime.formatIso(DateTime.toUtc(instant))
    .replace(/\.\d+Z$/, "Z")
    .replaceAll(/[-:]/g, "");
}

/** TEXT as iCalendar escapes it (RFC 5545, 3.3.11). */
export function icsText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * A content line folded at 75 octets (RFC 5545, 3.1): each continuation
 * starts with a space, and no character is split across lines.
 */
export function foldLine(line: string): string {
  const lines: Array<string> = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).byteLength;
    // Continuation lines spend one octet on their leading space.
    const limit = lines.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      lines.push(current);
      current = "";
      octets = 0;
    }
    current += character;
    octets += size;
  }
  lines.push(current);
  return lines.join("\r\n ");
}

/** The calendar event's title: the sign-off, else the name. */
export function calendarTitle(
  event: Pick<EventPage, "topic" | "name">,
): string {
  return event.topic === undefined ? event.name : `see you at/${event.topic}`;
}

/** The whole file for `event`, whose page is under `origin`. */
export function calendarFile(event: EventPage, origin: string): string {
  const page = eventUrl(origin, event.slug);
  const location = event.venue?.mapQuery ?? event.venue?.name ?? null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${productId}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@${uidDomain}`,
    // Without a METHOD, DTSTAMP is when the event's record last changed.
    `DTSTAMP:${icsInstant(event.updatedAt)}`,
    `DTSTART:${icsInstant(event.startsAt)}`,
    `DTEND:${icsInstant(event.endsAt)}`,
    `SUMMARY:${icsText(calendarTitle(event))}`,
    ...(location === null ? [] : [`LOCATION:${icsText(location)}`]),
    `DESCRIPTION:${icsText(page)}`,
    `URL:${page}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A file name for the event's calendar file: its slug, in plain ASCII. */
export function calendarFileName(slug: string): string {
  const name = slug
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/[^A-Za-z0-9-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return `${name === "" ? "evening" : name}.ics`;
}
