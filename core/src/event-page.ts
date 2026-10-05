import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Contract from "./contract.ts";
import { type DataSourceError, EventNotFound } from "./errors.ts";
import { type Evening, toEvening } from "./home.ts";
import { displayName, eventTopic } from "./lockup.ts";
import { eventStatus, httpUrlOrNull, personLinks, rsvpUrl } from "./mappers.ts";
import { type EventMode, eventMode } from "./mode.ts";
import { neighborhoodOf } from "./places.ts";
import { type SafeHtml, sanitizeRichText } from "./rich-text.ts";
import * as Rows from "./rows.ts";
import { listingJson, orDataSourceError, profileJson } from "./sql.ts";

/**
 * What an event's page shows, read as of the `Clock` in one statement: every
 * fact about the evening, named once (brand/foundations.md, "Voice"), and,
 * for an evening that is over, the one announced next. Drafts are never
 * read: their slugs are not found, as unknown ones are.
 */

/** The page shows at most this many of an evening's photos. */
export const photoLimit = 6;

/** Where the evening happens, as far as it is known. */
export interface Venue {
  /** The local name of its neighborhood, when the venue is a known one. */
  readonly neighborhood: string | null;
  /** The venue's name, when it is more than the start of its address. */
  readonly name: string | null;
  /** The address to print, without the venue's name it may start with. */
  readonly address: string | null;
  /** The address as stored, to look up on a map; null without an address. */
  readonly mapQuery: string | null;
}

/** Someone on stage, as a talk lists them. */
export interface Speaker {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly bio: string | null;
  readonly links: Contract.PersonLinks;
  /** Their profile's photo, when it is on the photo origin. */
  readonly portrait: Rows.Photo | null;
}

export interface Talk {
  readonly id: string;
  readonly title: string;
  /** Sanitized; null when it says nothing. */
  readonly description: SafeHtml | null;
  /** Everyone who gave it, in the order they were attached. */
  readonly speakers: ReadonlyArray<Speaker>;
}

/** A published event as its page shows it. */
export interface EventPage {
  readonly id: string;
  readonly slug: string;
  /** The name as written, without emoji. */
  readonly name: string;
  /** all things/<topic>: the one the site set, else the name's, if any. */
  readonly topic: string | undefined;
  readonly tagline: string;
  /** At the `Clock`'s now. */
  readonly status: Contract.EventStatus;
  /** Night for an evening, Paper for a daytime event (see mode.ts). */
  readonly mode: EventMode;
  readonly startsAt: DateTime.Utc;
  readonly endsAt: DateTime.Utc;
  /** When the event's record last changed. */
  readonly updatedAt: DateTime.Utc;
  /** Null when nothing about the place is known. */
  readonly venue: Venue | null;
  /** The hosting companies' names, in the order they were attached. */
  readonly hosts: ReadonlyArray<string>;
  /** Where "I'm in" goes: the event's Luma page. */
  readonly rsvpUrl: string | null;
  /** How many seats it has, when that is known. */
  readonly seats: number | null;
  readonly recordingUrl: string | null;
  readonly talks: ReadonlyArray<Talk>;
  /** The first photos attached, up to the limit, on the photo origin. */
  readonly photos: ReadonlyArray<Rows.Photo>;
  /** The live or next evening other than this one, if one is announced. */
  readonly next: Evening | undefined;
}

/** A `talks` row with its speakers, nested in the page's row. */
const TalkRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  speakers: Schema.Array(Rows.Profile),
});

/** What the page reads, in one statement. */
export const EventPageRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  tagline: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
  streetAddress: Schema.NullOr(Schema.String),
  shortLocation: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  recordingUrl: Schema.NullOr(Schema.String),
  attendeeLimit: Schema.Int,
  hosts: Schema.Array(Schema.String),
  talks: Schema.Array(TalkRow),
  photos: Schema.Array(Rows.Photo),
  next: Schema.NullOr(Rows.Listing),
});

export type EventPageRow = typeof EventPageRow.Type;

/** `text` trimmed, or null when nothing is left. */
const present = (text: string | null): string | null => {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/**
 * The venue from the event's three location fields, each said once. Luma
 * writes the full address as "<venue>, <address>", so a name the address
 * starts with is printed beside the rest of it. A "name" that is the start
 * of the address itself, such as a street address ("201 Spear St"), is no
 * name. The map looks up the address as stored, the venue's name included,
 * which places it best.
 */
export function toVenue(
  event: Pick<EventPageRow, "streetAddress" | "shortLocation" | "fullAddress">,
): Venue | null {
  const stored = present(event.fullAddress) ?? present(event.streetAddress);
  const neighborhood = neighborhoodOf([
    event.streetAddress,
    event.fullAddress,
    event.shortLocation,
  ]);
  let name = present(event.shortLocation);
  let address = stored;
  if (name !== null && address !== null) {
    const lowerName = name.toLowerCase();
    const lowerAddress = address.toLowerCase();
    // Whole words only: "Mux" doesn't start "Muxworks, 1 Main St".
    const startsWithName =
      lowerAddress.startsWith(lowerName) &&
      !/[\p{L}\p{N}]/u.test(lowerAddress.charAt(lowerName.length));
    // A street number starts an address, never a venue's name.
    const isVenue = !/^\d/.test(name);
    if (startsWithName && isVenue && lowerAddress.startsWith(`${lowerName},`)) {
      address = address.slice(name.length + 1).trim();
    } else if (startsWithName) {
      name = null;
    }
  }
  if (neighborhood === null && name === null && address === null) return null;
  return { neighborhood, name, address, mapQuery: stored };
}

/** A speaker from their profile; empty titles and bios read as unknown. */
function toSpeaker(profile: Rows.Profile, photoPrefix: string): Speaker {
  const image = profile.image;
  return {
    id: profile.id,
    name: profile.name,
    title: present(profile.title),
    bio: present(profile.bio),
    links: personLinks(profile),
    portrait:
      image === null || !image.url.startsWith(photoPrefix)
        ? null
        : {
            url: image.url,
            alt: image.alt,
            width: image.width,
            height: image.height,
          },
  };
}

/** Text left once tags are dropped: whether sanitized HTML says anything. */
const saysSomething = (html: SafeHtml): boolean =>
  html.replace(/<[^>]*>|&nbsp;|\s/g, "") !== "";

/**
 * The page for `row` as of `now`. Speakers' photos are taken only from
 * `photoOrigin`, as the row's photos were.
 */
export const toEventPage = (
  row: EventPageRow,
  now: DateTime.Utc,
  photoOrigin: string,
): Effect.Effect<EventPage> =>
  Effect.forEach(row.talks, (talk) =>
    Effect.map(
      sanitizeRichText(talk.description),
      (description): Talk => ({
        id: talk.id,
        title: talk.title,
        description: saysSomething(description) ? description : null,
        speakers: talk.speakers.map((profile) =>
          toSpeaker(profile, `${photoOrigin}/`),
        ),
      }),
    ),
  ).pipe(
    Effect.map(
      (talks): EventPage => ({
        id: row.id,
        slug: row.slug,
        name: displayName(row.name),
        topic: eventTopic(row),
        tagline: row.tagline,
        status: eventStatus(row, now),
        mode: eventMode(row.startDate),
        startsAt: row.startDate,
        endsAt: row.endDate,
        updatedAt: row.updatedAt,
        venue: toVenue(row),
        hosts: row.hosts,
        rsvpUrl: rsvpUrl(row.lumaEventId),
        seats: row.attendeeLimit > 0 ? row.attendeeLimit : null,
        recordingUrl: httpUrlOrNull(row.recordingUrl),
        talks,
        photos: row.photos,
        next: row.next === null ? undefined : toEvening(row.next, now),
      }),
    ),
  );

export interface EventPagesShape {
  /**
   * The published event at `slug` as of the `Clock`'s now. Photos are taken
   * only from `photoOrigin` (such as "https://media.allthings.dev"), the
   * one origin pages may load images from.
   */
  readonly read: (
    slug: string,
    photoOrigin: string,
  ) => Effect.Effect<EventPage, EventNotFound | DataSourceError>;
}

const Request = Schema.Struct({
  slug: Schema.String,
  now: Schema.DateTimeUtcFromDate,
  photoPrefix: Schema.String,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // Talks, speakers, hosts and photos in the order they were attached (the
  // join row's created_at, then id), as Events.getPublished lists them.
  // "Next" is what home leads with: the soonest event that hasn't ended.
  const findPage = SqlSchema.findOneOption({
    Request,
    Result: EventPageRow,
    execute: ({ slug, now, photoPrefix }) => sql`
      SELECT
        ev.id, ev.slug, ev.name, ev.topic, ev.tagline,
        ev.start_date AS "startDate", ev.end_date AS "endDate",
        ev.updated_at AS "updatedAt",
        ev.street_address AS "streetAddress",
        ev.short_location AS "shortLocation",
        ev.full_address AS "fullAddress",
        ev.luma_event_id AS "lumaEventId",
        ev.recording_url AS "recordingUrl",
        ev.attendee_limit AS "attendeeLimit",
        COALESCE((
          SELECT json_agg(s.name ORDER BY es.created_at, s.id)
          FROM event_sponsors es
          JOIN sponsors s ON s.id = es.sponsor_id
          WHERE es.event_id = ev.id
        ), '[]'::json) AS hosts,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', t.id,
            'title', t.title,
            'description', t.description,
            'speakers', COALESCE((
              SELECT json_agg(${sql.literal(profileJson)} ORDER BY ts.created_at, p.id)
              FROM talk_speakers ts
              JOIN profiles p ON p.id = ts.speaker_id
              WHERE ts.talk_id = t.id
            ), '[]'::json)
          ) ORDER BY et.created_at, t.id)
          FROM event_talks et
          JOIN talks t ON t.id = et.talk_id
          WHERE et.event_id = ev.id
        ), '[]'::json) AS talks,
        COALESCE((
          SELECT json_agg(json_build_object(
            'url', x.url, 'alt', x.alt, 'width', x.width, 'height', x.height
          ) ORDER BY x.created_at, x.id)
          FROM (
            SELECT img.url, img.alt, img.width, img.height, ei.created_at, img.id
            FROM event_images ei
            JOIN images img ON img.id = ei.image_id
            WHERE ei.event_id = ev.id AND starts_with(img.url, ${photoPrefix})
            ORDER BY ei.created_at, img.id
            LIMIT ${photoLimit}
          ) x
        ), '[]'::json) AS photos,
        (
          SELECT ${sql.literal(listingJson)}
          FROM events e
          WHERE e.is_draft = false AND e.end_date >= ${now} AND e.id <> ev.id
          ORDER BY e.start_date, e.id
          LIMIT 1
        ) AS next
      FROM events ev
      WHERE ev.slug = ${slug} AND ev.is_draft = false`,
  });

  return EventPages.of({
    read: (slug, photoOrigin) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const row = yield* orDataSourceError(
          findPage({ slug, now, photoPrefix: `${photoOrigin}/` }),
        );
        if (Option.isNone(row)) {
          return yield* Effect.fail(new EventNotFound({ slug }));
        }
        return yield* toEventPage(row.value, now, photoOrigin);
      }),
  });
});

export class EventPages extends Context.Service<EventPages, EventPagesShape>()(
  "allthings/EventPages",
) {
  static readonly layer = Layer.effect(EventPages, make);
}
