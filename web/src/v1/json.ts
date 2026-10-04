import { sanitizeRichText } from "allthings-core/src/rich-text.ts";
import { DateTime, type Option } from "effect";
import type {
  DirectoryRow,
  EventDetailsRow,
  EventRow,
  ImageRow,
  SpeakerRow,
} from "./data.ts";
import { mediaUrl } from "./media.ts";

/**
 * The v1 API's response bodies: the app's internal shapes as
 * app/src/app/api/v1/** serializes them, kept key for key and in the same key
 * order, so that clients of today's API see byte-identical JSON. These are not
 * the public contract (core/src/contract.ts); new clients should use MCP.
 */

/** An image as the app publishes it: stored ones keep every column. */
export type ImageJson =
  | {
      readonly id: string;
      readonly url: string;
      readonly placeholder: string;
      readonly alt: string;
      readonly width: number;
      readonly height: number;
      readonly createdAt: string;
      readonly updatedAt: string;
    }
  | {
      readonly url: string;
      readonly alt: string;
      readonly placeholder: null;
      readonly width: number;
      readonly height: number;
    };

export interface EventJson {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly slug: string;
  readonly tagline: string;
  readonly attendeeLimit: number;
  readonly streetAddress: string | null;
  readonly shortLocation: string | null;
  readonly fullAddress: string | null;
  readonly lumaEventId: string | null;
  readonly isHackathon: boolean;
  readonly isDraft: boolean;
  readonly highlightOnLandingPage: boolean;
  readonly previewImage: ImageJson;
  readonly recordingUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lumaEventUrl: string | null;
}

export interface EventDetailsJson extends EventJson {
  readonly talks: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    /** Sanitized editor HTML. */
    readonly description: string;
    readonly speakers: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly title: string;
      readonly image: ImageJson;
      readonly bio: string;
      /** Handles, each present only when set. */
      readonly socials: {
        readonly twitter?: string;
        readonly bluesky?: string;
        readonly linkedin?: string;
      };
    }>;
  }>;
  readonly hosts: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly about: string;
    readonly squareLogoLight: ImageJson;
    readonly squareLogoDark: ImageJson;
  }>;
  readonly images: ReadonlyArray<ImageJson>;
}

export interface SpeakerJson {
  readonly id: string;
  readonly name: string;
  readonly image: ImageJson;
  readonly title: string;
  readonly bio: string;
  readonly type: "organizer" | "member";
  readonly socials: {
    readonly linkedinUrl: string | null;
    readonly twitterUrl: string | null;
    readonly blueskyUrl: string | null;
  };
  /** The speaker's talks, newest event first. */
  readonly talkIds: ReadonlyArray<string>;
}

const iso = DateTime.formatIso;

/** Image URLs are rewritten for the legacy bucket, if there is one. */
export type LegacyMediaOrigin = Option.Option<string>;

function image(row: ImageRow, legacy: LegacyMediaOrigin): ImageJson {
  return {
    id: row.id,
    url: mediaUrl(row.url, legacy),
    placeholder: row.placeholder,
    alt: row.alt,
    width: row.width,
    height: row.height,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** The brand's blank avatar, for people and hosts without a photo or logo. */
function blankAvatar(name: string): ImageJson {
  return {
    url: "/brand/avatar.png",
    alt: name,
    placeholder: null,
    width: 512,
    height: 512,
  };
}

/** The cover of an event without a preview image. */
function defaultCover(name: string): ImageJson {
  return {
    url: "/hero-image-rocket.png",
    alt: `${name} preview`,
    placeholder: null,
    width: 1200,
    height: 630,
  };
}

/** Registration happens on the event's Luma page; the id is not encoded. */
function lumaEventUrl(lumaEventId: string | null): string | null {
  return lumaEventId ? `https://lu.ma/event/${lumaEventId}` : null;
}

/** An event as /api/v1/events lists it: its row, cover and Luma page. */
export function eventJson(row: EventRow, legacy: LegacyMediaOrigin): EventJson {
  return {
    id: row.id,
    name: row.name,
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
    slug: row.slug,
    tagline: row.tagline,
    attendeeLimit: row.attendeeLimit,
    streetAddress: row.streetAddress,
    shortLocation: row.shortLocation,
    fullAddress: row.fullAddress,
    lumaEventId: row.lumaEventId,
    isHackathon: row.isHackathon,
    isDraft: row.isDraft,
    highlightOnLandingPage: row.highlightOnLandingPage,
    previewImage:
      row.previewImage === null
        ? defaultCover(row.name)
        : image(row.previewImage, legacy),
    recordingUrl: row.recordingUrl,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    lumaEventUrl: lumaEventUrl(row.lumaEventId),
  };
}

/** A talk speaker's handles; empty ones are left out, as the app leaves them. */
function handles(
  speaker: SpeakerRow,
): EventDetailsJson["talks"][number]["speakers"][number]["socials"] {
  return {
    ...(speaker.twitterHandle ? { twitter: speaker.twitterHandle } : {}),
    ...(speaker.blueskyHandle ? { bluesky: speaker.blueskyHandle } : {}),
    ...(speaker.linkedinHandle ? { linkedin: speaker.linkedinHandle } : {}),
  };
}

/**
 * An event as /api/v1/events/:id answers it: the listed shape plus talks with
 * sanitized descriptions and their speakers, hosts and photos.
 */
export function eventDetailsJson(
  row: EventDetailsRow,
  legacy: LegacyMediaOrigin,
): EventDetailsJson {
  const photo = (value: ImageRow | null, name: string) =>
    value === null ? blankAvatar(name) : image(value, legacy);
  return {
    ...eventJson(row, legacy),
    talks: row.talks.map((talk) => ({
      id: talk.id,
      title: talk.title,
      description: sanitizeRichText(talk.description),
      speakers: talk.speakers.map((speaker) => ({
        id: speaker.id,
        name: speaker.name,
        title: speaker.title,
        image: photo(speaker.image, speaker.name),
        bio: speaker.bio,
        socials: handles(speaker),
      })),
    })),
    // A host with one logo variant uses it for both.
    hosts: row.hosts.map((host) => ({
      id: host.id,
      name: host.name,
      about: host.about,
      squareLogoLight: photo(
        host.squareLogoLight ?? host.squareLogoDark,
        host.name,
      ),
      squareLogoDark: photo(
        host.squareLogoDark ?? host.squareLogoLight,
        host.name,
      ),
    })),
    images: row.images.map((value) => image(value, legacy)),
  };
}

/**
 * Folds one row per speaker and talk into speakers in first-appearance
 * order, each with their distinct talk ids, as the app's directory does.
 */
export function speakersJson(
  rows: ReadonlyArray<DirectoryRow>,
  legacy: LegacyMediaOrigin,
): Array<SpeakerJson> {
  const speakers = new Map<
    string,
    {
      readonly profile: DirectoryRow["profile"];
      readonly talkIds: Array<string>;
    }
  >();
  for (const { profile, talkId } of rows) {
    const speaker = speakers.get(profile.id) ?? { profile, talkIds: [] };
    speakers.set(profile.id, speaker);
    if (!speaker.talkIds.includes(talkId)) speaker.talkIds.push(talkId);
  }
  return Array.from(speakers.values(), ({ profile, talkIds }) => ({
    id: profile.id,
    name: profile.name,
    image:
      profile.image === null
        ? blankAvatar(profile.name)
        : image(profile.image, legacy),
    title: profile.title,
    bio: profile.bio,
    type: profile.profileType,
    socials: {
      linkedinUrl: profile.linkedinHandle
        ? `https://www.linkedin.com/in/${profile.linkedinHandle}`
        : null,
      twitterUrl: profile.twitterHandle
        ? `https://twitter.com/${profile.twitterHandle}`
        : null,
      blueskyUrl: profile.blueskyHandle
        ? `https://bsky.app/profile/${profile.blueskyHandle}`
        : null,
    },
    talkIds,
  }));
}
