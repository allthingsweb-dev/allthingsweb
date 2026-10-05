import { DateTime, Effect, Schema } from "effect";
import * as Contract from "./contract.ts";
import { htmlToPlainText, sanitizeRichText } from "./rich-text.ts";
import type * as Rows from "./rows.ts";
import type { SpeakerDirectory } from "./speakers.ts";

/**
 * Repository rows to the public contract: a port of
 * app/src/lib/public-api/mappers.ts plus the list_events selection from
 * app/src/lib/mcp/tools.ts. Everything here is pure; the current time comes
 * in as `now`, which callers read from the `Clock` with `DateTime.now`.
 *
 * `origin` is the site's origin without a trailing slash, such as
 * "https://allthingsweb.dev"; public URLs are built from it.
 */

/** Upcoming before the start, live from the start through the end, then past. */
export function eventStatus(
  event: Pick<Rows.Event, "startDate" | "endDate">,
  now: DateTime.Utc,
): Contract.EventStatus {
  if (DateTime.isLessThan(now, event.startDate)) return "upcoming";
  if (DateTime.isLessThanOrEqualTo(now, event.endDate)) return "live";
  return "past";
}

const isHttpUrl = Schema.is(Contract.HttpUrl);

/**
 * A stored URL in its normalized form, or null unless it is an http(s) URL the
 * contract accepts. The app checks only the protocol, so a stored URL such as
 * "https://localhost" would fail its response validation; here it is dropped.
 */
export function httpUrlOrNull(value: string | null): string | null {
  if (!value) return null;
  const url = URL.parse(value);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return null;
  }
  return isHttpUrl(url.href) ? url.href : null;
}

/** An event's page: its slug, encoded, under the origin. */
export function eventUrl(origin: string, slug: string): string {
  return `${origin}/${encodeURIComponent(slug)}`;
}

/** Profiles store handles; links are built from them as the site shows them. */
export function personLinks(
  profile: Pick<
    Rows.Profile,
    "twitterHandle" | "blueskyHandle" | "linkedinHandle"
  >,
): Contract.PersonLinks {
  const link = (prefix: string, handle: string | null) =>
    handle ? httpUrlOrNull(`${prefix}${handle}`) : null;
  return {
    x: link("https://twitter.com/", profile.twitterHandle),
    bluesky: link("https://bsky.app/profile/", profile.blueskyHandle),
    linkedin: link("https://www.linkedin.com/in/", profile.linkedinHandle),
  };
}

/** Registration happens on the event's Luma page. */
export function rsvpUrl(lumaEventId: string | null): string | null {
  return lumaEventId
    ? httpUrlOrNull(`https://lu.ma/event/${lumaEventId}`)
    : null;
}

/** A speaker as a talk lists them; empty titles and bios read as unknown. */
function talkSpeaker(profile: Rows.Profile): Contract.TalkSpeaker {
  return {
    name: profile.name,
    title: profile.title || null,
    bio: profile.bio || null,
    links: personLinks(profile),
  };
}

/** An event as list_events shows it, with its status at `now`. */
export function toEventSummary(
  event: Rows.Event,
  origin: string,
  now: DateTime.Utc,
): Contract.EventSummary {
  const hasVenue = event.shortLocation !== null || event.fullAddress !== null;
  return {
    slug: event.slug,
    name: event.name,
    tagline: event.tagline,
    url: eventUrl(origin, event.slug),
    status: eventStatus(event, now),
    startsAt: DateTime.formatIso(event.startDate),
    endsAt: DateTime.formatIso(event.endDate),
    timeZone: "America/Los_Angeles",
    venue: hasVenue
      ? { name: event.shortLocation, address: event.fullAddress }
      : null,
    rsvpUrl: rsvpUrl(event.lumaEventId),
    recordingUrl: httpUrlOrNull(event.recordingUrl),
    isHackathon: event.isHackathon,
  };
}

/** An event as get_event shows it: the summary plus talks, as plain text, and hosts. */
export const toEvent = (
  event: Rows.EventDetails,
  origin: string,
  now: DateTime.Utc,
): Effect.Effect<Contract.Event> =>
  Effect.forEach(event.talks, (talk) =>
    Effect.map(sanitizeRichText(talk.description), (description) => ({
      title: talk.title,
      description: htmlToPlainText(description),
      speakers: talk.speakers.map(talkSpeaker),
    })),
  ).pipe(
    Effect.map((talks) => ({
      ...toEventSummary(event, origin, now),
      talks,
      hosts: event.hosts.map((host) => ({
        name: host.name,
        about: host.about,
      })),
    })),
  );

/**
 * The directory as list_speakers shows it: each speaker with their talks,
 * newest first, linked to the events they were given at.
 */
export function toSpeakers(
  directory: SpeakerDirectory,
  origin: string,
): Array<Contract.Speaker> {
  const talksBySpeaker = new Map<
    string,
    Array<Contract.Speaker["talks"][number]>
  >();
  for (const talk of directory.talks) {
    for (const speakerId of talk.speakerIds) {
      const talks = talksBySpeaker.get(speakerId) ?? [];
      talks.push({
        title: talk.title,
        eventName: talk.eventName,
        eventSlug: talk.eventSlug,
        eventUrl: eventUrl(origin, talk.eventSlug),
        date: DateTime.formatIso(talk.eventStart),
      });
      talksBySpeaker.set(speakerId, talks);
    }
  }
  return directory.speakers.map(({ profile }) => ({
    ...talkSpeaker(profile),
    talks: talksBySpeaker.get(profile.id) ?? [],
  }));
}

/** Which events list_events returns. Live events count as upcoming. */
export type EventSelection = "upcoming" | "past" | "all";

/**
 * Filters and orders events for listing: upcoming soonest first, past and all
 * most recent first. Events that start together keep their input order.
 */
export function selectEvents<
  E extends Pick<Rows.Event, "startDate" | "endDate">,
>(events: ReadonlyArray<E>, when: EventSelection, now: DateTime.Utc): Array<E> {
  const direction = when === "upcoming" ? 1 : -1;
  return events
    .filter((event) => {
      if (when === "all") return true;
      const isPast = eventStatus(event, now) === "past";
      return when === "past" ? isPast : !isPast;
    })
    .toSorted(
      (a, b) =>
        direction *
        (DateTime.toEpochMillis(a.startDate) -
          DateTime.toEpochMillis(b.startDate)),
    );
}
