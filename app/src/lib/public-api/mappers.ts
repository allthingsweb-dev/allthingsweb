import sanitizeHtml from "sanitize-html";
import { community } from "@/lib/community";
import type { Event } from "@/lib/events";
import type { ExpandedEvent } from "@/lib/expanded-events";
import { getSocialUrls } from "@/lib/social-links";
import type { getSpeakerDirectory } from "@/lib/speaker-directory";
import type {
  EventStatus,
  PublicCommunity,
  PublicEvent,
  PublicEventSummary,
  PublicSpeaker,
} from "./schemas";

export type SpeakerDirectory = Awaited<ReturnType<typeof getSpeakerDirectory>>;

type SocialHandles = {
  twitterHandle?: string | null | undefined;
  blueskyHandle?: string | null | undefined;
  linkedinHandle?: string | null | undefined;
};

export function eventStatus(
  event: Pick<Event, "startDate" | "endDate">,
  now: Date,
): EventStatus {
  if (now < event.startDate) return "upcoming";
  if (now <= event.endDate) return "live";
  return "past";
}

/** Stored URLs are only published when they are valid http(s) URLs. */
export function httpUrlOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function eventUrl(origin: string, slug: string): string {
  return `${origin}/${encodeURIComponent(slug)}`;
}

function personLinks(handles: SocialHandles) {
  const urls = getSocialUrls(handles);
  return {
    x: httpUrlOrNull(urls.twitterUrl),
    bluesky: httpUrlOrNull(urls.blueskyUrl),
    linkedin: httpUrlOrNull(urls.linkedinUrl),
  };
}

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Flattens editor HTML into readable plain text for agents. */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|ul|ol|blockquote|pre|h[1-6])>/gi, "\n");
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => entities[entity]!)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toPublicEventSummary(
  event: Event,
  origin: string,
  now: Date,
): PublicEventSummary {
  const hasVenue = event.shortLocation !== null || event.fullAddress !== null;
  return {
    slug: event.slug,
    name: event.name,
    tagline: event.tagline,
    url: eventUrl(origin, event.slug),
    status: eventStatus(event, now),
    startsAt: event.startDate.toISOString(),
    endsAt: event.endDate.toISOString(),
    timeZone: "America/Los_Angeles",
    venue: hasVenue
      ? { name: event.shortLocation, address: event.fullAddress }
      : null,
    rsvpUrl: httpUrlOrNull(event.lumaEventUrl),
    recordingUrl: httpUrlOrNull(event.recordingUrl),
    isHackathon: event.isHackathon,
  };
}

export function toPublicEvent(
  event: ExpandedEvent,
  origin: string,
  now: Date,
): PublicEvent {
  return {
    ...toPublicEventSummary(event, origin, now),
    talks: event.talks.map((talk) => ({
      title: talk.title,
      description: htmlToPlainText(talk.description),
      speakers: talk.speakers.map((speaker) => ({
        name: speaker.name,
        title: speaker.title || null,
        bio: speaker.bio || null,
        links: personLinks({
          twitterHandle: speaker.socials.twitter,
          blueskyHandle: speaker.socials.bluesky,
          linkedinHandle: speaker.socials.linkedin,
        }),
      })),
    })),
    hosts: event.sponsors.map((host) => ({
      name: host.name,
      about: host.about,
    })),
  };
}

export function toPublicSpeakers(
  directory: SpeakerDirectory,
  origin: string,
): PublicSpeaker[] {
  const talksBySpeaker = new Map<string, PublicSpeaker["talks"]>();
  for (const talk of directory.talks) {
    for (const speakerId of talk.speakerIds) {
      const talks = talksBySpeaker.get(speakerId) ?? [];
      talks.push({
        title: talk.title,
        eventName: talk.eventName,
        eventSlug: talk.eventSlug,
        eventUrl: eventUrl(origin, talk.eventSlug),
        date: talk.eventStart.toISOString(),
      });
      talksBySpeaker.set(speakerId, talks);
    }
  }

  return directory.speakers.map(({ profile }) => ({
    name: profile.name,
    title: profile.title || null,
    bio: profile.bio || null,
    links: personLinks(profile),
    talks: talksBySpeaker.get(profile.id) ?? [],
  }));
}

export function toPublicCommunity(origin: string): PublicCommunity {
  return {
    name: "All Things Web",
    oneLiner: community.oneLiner,
    introduction: community.introduction,
    mission: community.mission,
    history: community.history,
    independence: community.independence,
    hosting: community.hosting,
    links: {
      website: origin,
      events: community.links.events,
      discord: community.links.discord,
      codeOfConduct: `${origin}/code-of-conduct`,
    },
  };
}
