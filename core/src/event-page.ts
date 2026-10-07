import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { pageNow } from "./clock.ts";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Contract from "./contract.ts";
import {
  ahead,
  drafts,
  hostsOf,
  linkFirst,
  ours,
  peopleOf,
  published,
  resolve,
  soonestFirst,
  talksOf,
} from "./catalog.ts";
import { type DataSourceError, EventNotFound } from "./errors.ts";
import { type Evening, toEvening } from "./home.ts";
import { displayName, eventTopic } from "./lockup.ts";
import { eventStatus } from "./catalog.ts";
import { httpUrlOrNull, personLinks, rsvpUrl } from "./mappers.ts";
import { type EventMode, eventMode } from "./mode.ts";
import { type StageRole, stageRole } from "./people.ts";
import { neighborhoodOf } from "./places.ts";
import { type SafeHtml, sanitizeRichText } from "./rich-text.ts";
import * as Rows from "./rows.ts";
import { eventTagline } from "./tagline.ts";
import {
  curationJson,
  listingJson,
  orDataSourceError,
  profileJson,
  siteSlug,
} from "./sql.ts";

/**
 * What an event's page shows, read as of the `Clock` in one statement: every
 * fact about the evening, named once (brand/foundations.md, "Voice"), and,
 * for an evening that is over, the one announced next. An evening is found
 * by its short link, any link it had before, or its long slug. Drafts are
 * never read: their slugs are not found, as unknown ones are.
 */

/**
 * The fewest guests the page counts. Luma's counts for our earliest
 * evenings (4, 6, 18) are artifacts of moving to it, not who came, so a
 * smaller count is left unsaid rather than shown wrong.
 */
export const guestCountFloor = 20;

/**
 * The most posts about an evening its page lists, earliest first. Past
 * this, the page links to more on X.
 */
export const postLimit = 8;

/** The most characters of a post's text a page prints; the rest is a link away. */
export const postTextLimit = 560;

/** A post about the evening on a social platform, as the page shows it. */
export interface Post {
  /** The post itself, where the page links. */
  readonly url: string;
  readonly platform: "x" | "bluesky" | "linkedin" | "other";
  readonly authorName: string;
  readonly authorHandle: string | null;
  /** The author's profile, when it is an http(s) URL. */
  readonly authorUrl: string | null;
  readonly postedAt: DateTime.Utc;
  /** Plain text, cut at {@link postTextLimit} with an ellipsis. */
  readonly text: string;
  /** Its first image, once copied to the photo origin. */
  readonly image: Rows.Photo | null;
  /** Its author's avatar, once copied to the photo origin. */
  readonly avatar: Rows.Photo | null;
}

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

/** Someone who took part, as the page names them. */
export interface Person {
  readonly id: string;
  /** Their page's address, /people/<slug>. */
  readonly slug: string;
  readonly name: string;
  readonly title: string | null;
  /** Their profile's photo, when it is on the photo origin. */
  readonly portrait: Rows.Photo | null;
}

/** Someone on stage, as a talk lists them. */
export interface Speaker extends Person {
  readonly bio: string | null;
  readonly links: Contract.PersonLinks;
  /** Their capacity in the talk: speaker, panelist, guest or moderator. */
  readonly role: StageRole;
}

export interface Talk {
  readonly id: string;
  readonly title: string;
  /** How it is held: a talk, a panel or a fireside chat. */
  readonly format: Rows.TalkFormat;
  /** When it started, where the running order says. */
  readonly startsAt: DateTime.Utc | null;
  /** Sanitized; null when it says nothing. */
  readonly description: SafeHtml | null;
  /** Everyone who gave it, in the order they were attached. */
  readonly speakers: ReadonlyArray<Speaker>;
}

/** A step of the event's schedule. */
export interface ScheduleItem {
  /** As the organizers wrote it: "1 - 7 pm", "~7:00 pm". */
  readonly time: string;
  readonly title: string;
  /** Null when it says nothing. */
  readonly description: string | null;
}

/** A row of the page under its own label, such as a hackathon's awards. */
export interface Note {
  readonly label: string;
  /** Sanitized. */
  readonly body: SafeHtml;
}

/** A published event as its page shows it. */
export interface EventPage {
  readonly id: string;
  /**
   * Where it is on this site: its short link (src/short-slugs.ts), or its
   * long slug until it has one. A page asked for at any other slug of the
   * evening redirects here.
   */
  readonly slug: string;
  /** The name as written, without emoji. */
  readonly name: string;
  /** allthings/<topic>: the one the site set, else the name's, if any. */
  readonly topic: string | undefined;
  /**
   * The evening in one line: the organizers' tagline, or the summary of
   * Luma's description while that is a placeholder; empty without either
   * (src/tagline.ts).
   */
  readonly tagline: string;
  /**
   * What the evening is about, in its own words: the site's description
   * when it says something, else Luma's. Sanitized; null when neither does.
   */
  readonly about: SafeHtml | null;
  /**
   * Whose words `about` is: the site's own, or Luma's as imported, which
   * the page may trim of what its stage repeats (src/stage-repeats.ts).
   */
  readonly aboutSource: "site" | "luma" | null;
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
  /**
   * Each hosting company's own website, by its name, where one is on
   * record as an http(s) URL; "Hosted at" links the name to it.
   */
  readonly hostSites: Readonly<Record<string, string>>;
  /** Its organizers, in their order; none when none are recorded. */
  readonly organizers: ReadonlyArray<Person>;
  /** People who co-host it, in their order. */
  readonly coHosts: ReadonlyArray<Person>;
  /** Its MC, if it has one (or more). */
  readonly mcs: ReadonlyArray<Person>;
  /**
   * Guests going, or who went once it is over, as Luma counts them; null
   * below {@link guestCountFloor}.
   */
  readonly guests: number | null;
  /** Where "I'm in" goes: the event's Luma page. */
  readonly rsvpUrl: string | null;
  /** How many seats it has, when that is known. */
  readonly seats: number | null;
  /** What kind of evening it is: talks, an open floor, social, a hackathon. */
  readonly program: Rows.EventProgram;
  /** Ours, or someone else's evening we share, with who organizes it. */
  readonly curation: Rows.Curation;
  readonly recordingUrl: string | null;
  readonly talks: ReadonlyArray<Talk>;
  /** Its schedule, in order; none when none is recorded. */
  readonly schedule: ReadonlyArray<ScheduleItem>;
  /** Rows of its own, such as "Awards" and "Theme", in order. */
  readonly notes: ReadonlyArray<Note>;
  /**
   * Every photo attached on the photo origin, in the order attached: pages
   * show them as variants sized for the layout (web/src/images/).
   */
  readonly photos: ReadonlyArray<Rows.Photo>;
  /**
   * Approved posts about the evening, earliest first, at most
   * {@link postLimit}. Hidden and pending ones never show.
   */
  readonly posts: ReadonlyArray<Post>;
  /** Approved posts past {@link postLimit}, which the page doesn't list. */
  readonly morePosts: number;
  /**
   * Our live or next evening other than this one, if one is announced: the
   * evening home leads with, never one we only share.
   */
  readonly next: Evening | undefined;
}

/** A `talks` row with its speakers, nested in the page's row. */
const TalkRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  format: Rows.TalkFormat,
  startsAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  speakers: Schema.Array(Rows.TalkSpeaker),
});

const ScheduleItemRow = Schema.Struct({
  time: Schema.String,
  title: Schema.String,
  description: Schema.String,
});

const NoteRow = Schema.Struct({
  label: Schema.String,
  body: Schema.String,
});

/** A post about the evening, nested in the page's row. */
const PostRow = Schema.Struct({
  url: Schema.String,
  platform: Schema.Literals(["x", "bluesky", "linkedin", "other"]),
  authorName: Schema.String,
  authorHandle: Schema.NullOr(Schema.String),
  authorUrl: Schema.NullOr(Schema.String),
  postedAt: Schema.DateTimeUtcFromString,
  text: Schema.String,
  image: Schema.NullOr(Rows.Photo),
  avatar: Schema.NullOr(Rows.Photo),
});

/** What the page reads, in one statement. */
export const EventPageRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  tagline: Schema.String,
  description: Schema.NullOr(Schema.String),
  lumaDescription: Schema.NullOr(Schema.String),
  lumaSummary: Schema.NullOr(Schema.String),
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
  streetAddress: Schema.NullOr(Schema.String),
  shortLocation: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  recordingUrl: Schema.NullOr(Schema.String),
  attendeeLimit: Schema.Int,
  lumaGuestCount: Schema.NullOr(Schema.Int),
  program: Rows.EventProgram,
  curation: Rows.Curation,
  hosts: Schema.Array(Schema.String),
  hostSites: Schema.Record(Schema.String, Schema.String),
  people: Schema.Array(Rows.EventPerson),
  talks: Schema.Array(TalkRow),
  schedule: Schema.Array(ScheduleItemRow),
  notes: Schema.Array(NoteRow),
  photos: Schema.Array(Rows.Photo),
  posts: Schema.Array(PostRow),
  postCount: Schema.Int,
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

/** Someone from their profile; an empty title reads as unknown. */
function toPerson(profile: Rows.Profile, photoPrefix: string): Person {
  const image = profile.image;
  return {
    id: profile.id,
    slug: profile.slug,
    name: profile.name,
    title: present(profile.title),
    portrait:
      image === null || !image.url.startsWith(photoPrefix)
        ? null
        : {
            url: image.url,
            alt: image.alt,
            width: image.width,
            height: image.height,
            version: image.version,
          },
  };
}

/** A speaker in a talk held as `format`; an empty bio reads as unknown. */
function toSpeaker(
  speaker: Rows.TalkSpeaker,
  format: Rows.TalkFormat,
  photoPrefix: string,
): Speaker {
  return {
    ...toPerson(speaker, photoPrefix),
    bio: present(speaker.bio),
    links: personLinks(speaker),
    role: stageRole(format, speaker.role),
  };
}

/** The people with `role` in the event, in their order. */
const peopleIn = (
  row: EventPageRow,
  role: Rows.EventRole,
  photoPrefix: string,
): ReadonlyArray<Person> =>
  row.people
    .filter((person) => person.role === role)
    .map((person) => toPerson(person.profile, photoPrefix));

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * `text` trimmed to at most `limit` characters as people see them (an
 * emoji or an accented letter is one), cut at a word where one ends near
 * the limit, with an ellipsis when anything was cut.
 */
export function excerpt(text: string, limit: number = postTextLimit): string {
  const chars = Array.from(graphemes.segment(text.trim()), (g) => g.segment);
  if (chars.length <= limit) return chars.join("");
  const cut = chars.slice(0, limit - 1).join("");
  const space = cut.search(/\s\S*$/u);
  return `${(space > cut.length * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A post as the page shows it: links only when http(s). */
function toPost(post: typeof PostRow.Type): Post | null {
  const url = httpUrlOrNull(post.url);
  if (url === null) return null;
  return {
    url,
    platform: post.platform,
    authorName: post.authorName,
    authorHandle: present(post.authorHandle),
    authorUrl: httpUrlOrNull(post.authorUrl),
    postedAt: post.postedAt,
    text: excerpt(post.text),
    image: post.image,
    avatar: post.avatar,
  };
}

/** Text left once tags are dropped: whether sanitized HTML says anything. */
const saysSomething = (html: SafeHtml): boolean =>
  html.replace(/<[^>]*>|&nbsp;|\s/g, "") !== "";

/**
 * What the evening is about, and whose words: the site's description when
 * it says something once sanitized, else Luma's, else null.
 */
export const aboutOf = (
  row: Pick<EventPageRow, "description" | "lumaDescription">,
): Effect.Effect<{
  readonly html: SafeHtml | null;
  readonly source: "site" | "luma" | null;
}> =>
  Effect.gen(function* () {
    for (const [source, text] of [
      ["site", row.description],
      ["luma", row.lumaDescription],
    ] as const) {
      if (text === null) continue;
      const html = yield* sanitizeRichText(text);
      if (saysSomething(html)) return { html, source };
    }
    return { html: null, source: null };
  });

/**
 * The page for `row` as of `now`. Speakers' photos are taken only from
 * `photoOrigin`, as the row's photos were.
 */
export const toEventPage = (
  row: EventPageRow,
  now: DateTime.Utc,
  photoOrigin: string,
): Effect.Effect<EventPage> =>
  Effect.all([
    Effect.forEach(row.talks, (talk) =>
      Effect.map(
        sanitizeRichText(talk.description),
        (description): Talk => ({
          id: talk.id,
          title: talk.title,
          format: talk.format,
          startsAt: talk.startsAt,
          description: saysSomething(description) ? description : null,
          speakers: talk.speakers.map((speaker) =>
            toSpeaker(speaker, talk.format, `${photoOrigin}/`),
          ),
        }),
      ),
    ),
    Effect.forEach(row.notes, (note) =>
      Effect.map(
        sanitizeRichText(note.body),
        (body): Note => ({ label: note.label.trim(), body }),
      ),
    ),
    aboutOf(row),
  ]).pipe(
    Effect.map(
      ([talks, notes, about]): EventPage => ({
        id: row.id,
        slug: row.slug,
        name: displayName(row.name),
        topic: eventTopic(row),
        tagline: eventTagline(row),
        about: about.html,
        aboutSource: about.source,
        status: eventStatus(row, now),
        mode: eventMode(row.startDate),
        startsAt: row.startDate,
        endsAt: row.endDate,
        updatedAt: row.updatedAt,
        venue: toVenue(row),
        hosts: row.hosts,
        hostSites: Object.fromEntries(
          Object.entries(row.hostSites).flatMap(([name, url]) => {
            const site = httpUrlOrNull(url);
            return site === null ? [] : [[name, site] as const];
          }),
        ),
        organizers: peopleIn(row, "organizer", `${photoOrigin}/`),
        coHosts: peopleIn(row, "co-host", `${photoOrigin}/`),
        mcs: peopleIn(row, "mc", `${photoOrigin}/`),
        guests:
          row.lumaGuestCount !== null && row.lumaGuestCount >= guestCountFloor
            ? row.lumaGuestCount
            : null,
        rsvpUrl: rsvpUrl(row.lumaEventId),
        seats: row.attendeeLimit > 0 ? row.attendeeLimit : null,
        program: row.program,
        curation: row.curation,
        recordingUrl: httpUrlOrNull(row.recordingUrl),
        talks,
        schedule: row.schedule.map(
          (item): ScheduleItem => ({
            time: item.time.trim(),
            title: item.title.trim(),
            description: present(item.description),
          }),
        ),
        // A note without a label or anything to say would be an empty row.
        notes: notes.filter(
          (note) => note.label !== "" && saysSomething(note.body),
        ),
        photos: row.photos,
        posts: row.posts.flatMap((post) => {
          const shown = toPost(post);
          return shown === null ? [] : [shown];
        }),
        morePosts: Math.max(0, row.postCount - row.posts.length),
        next: row.next === null ? undefined : toEvening(row.next, now),
      }),
    ),
  );

export interface EventPagesShape {
  /**
   * The published event at `slug` (its short link, one it had, or its long
   * slug) as of the `Clock`'s now; its `slug` says where it is now.
   * Photos are taken only from `photoOrigin` (such as
   * "https://media.allthings.dev"), the one origin pages may load images
   * from.
   */
  readonly read: (
    slug: string,
    photoOrigin: string,
  ) => Effect.Effect<EventPage, EventNotFound | DataSourceError>;
  /**
   * The draft at `slug` (its long slug, or a short link it has), read as
   * a published one is: what the draft preview renders, behind Cloudflare
   * Access (web/src/preview/). A published event is not a draft, so it is
   * not found here; no public route ever calls this.
   */
  readonly readDraft: (
    slug: string,
    photoOrigin: string,
  ) => Effect.Effect<EventPage, EventNotFound | DataSourceError>;
}

const Request = Schema.Struct({
  slug: Schema.String,
  now: Schema.DateTimeUtcFromDate,
  photoPrefix: Schema.String,
  /** Whether the page is a draft's: the preview reads only drafts, every public route only published events. */
  draft: Schema.Boolean,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  /**
   * The image `column` references, as a `Rows.Photo` in JSON, when it is
   * on the photo origin; else NULL.
   */
  const photoOf = (
    column: ReturnType<typeof sql.literal>,
    photoPrefix: string,
  ) => sql`(
    SELECT json_build_object('url', i.url, 'alt', i.alt, 'width', i.width,
      'height', i.height,
      'version', floor(extract(epoch FROM i.updated_at))::bigint::text)
    FROM images i
    WHERE i.id = ${column} AND starts_with(i.url, ${photoPrefix}))`;

  // The lineup in the catalog's order, as every surface lists it; photos
  // in the order they were attached, the schedule and notes by position.
  // "Next" is the soonest of ours not yet over, as home leads with it.
  const findPage = SqlSchema.findOneOption({
    Request,
    Result: EventPageRow,
    execute: ({ slug, now, photoPrefix, draft }) => sql`
      SELECT
        ev.id, ${sql.literal(siteSlug("ev"))} AS slug, ev.name, ev.topic,
        ev.tagline, ev.description,
        ev.luma_description AS "lumaDescription",
        ev.luma_summary AS "lumaSummary",
        ev.start_date AS "startDate", ev.end_date AS "endDate",
        ev.updated_at AS "updatedAt",
        ev.street_address AS "streetAddress",
        ev.short_location AS "shortLocation",
        ev.full_address AS "fullAddress",
        ev.luma_event_id AS "lumaEventId",
        ev.recording_url AS "recordingUrl",
        ev.attendee_limit AS "attendeeLimit",
        ev.luma_guest_count AS "lumaGuestCount", ev.program,
        ${sql.literal(curationJson("ev"))} AS curation,
        ${hostsOf(sql, "ev", sql`s.name`)} AS hosts,
        COALESCE((
          SELECT json_object_agg(s.name, s.website_url)
          FROM event_sponsors es
          JOIN sponsors s ON s.id = es.sponsor_id
          WHERE es.event_id = ev.id AND s.website_url IS NOT NULL
        ), '{}'::json) AS "hostSites",
        ${peopleOf(
          sql,
          "ev",
          sql`json_build_object('role', ep.role, 'profile', ${sql.literal(profileJson)})`,
        )} AS people,
        ${talksOf(sql, "ev", {
          talk: sql`'id', t.id, 'title', t.title,
            'description', t.description, 'format', t.format,
            'startsAt', et.starts_at`,
          speaker: sql`(${sql.literal(profileJson)})::jsonb
            || jsonb_build_object('role', ts.role)`,
        })} AS talks,
        COALESCE((
          SELECT json_agg(json_build_object(
            'time', si.time, 'title', si.title, 'description', si.description
          ) ORDER BY si.position)
          FROM event_schedule_items si
          WHERE si.event_id = ev.id
        ), '[]'::json) AS schedule,
        COALESCE((
          SELECT json_agg(json_build_object('label', n.label, 'body', n.body)
            ORDER BY n.position)
          FROM event_notes n
          WHERE n.event_id = ev.id
        ), '[]'::json) AS notes,
        COALESCE((
          SELECT json_agg(json_build_object(
            'url', x.url, 'alt', x.alt, 'width', x.width, 'height', x.height,
            'version', x.version
          ) ORDER BY x.created_at, x.id)
          FROM (
            SELECT img.url, img.alt, img.width, img.height, ei.created_at, img.id,
              floor(extract(epoch FROM img.updated_at))::bigint::text AS version
            FROM event_images ei
            JOIN images img ON img.id = ei.image_id
            WHERE ei.event_id = ev.id AND starts_with(img.url, ${photoPrefix})
          ) x
        ), '[]'::json) AS photos,
        COALESCE((
          SELECT json_agg(json_build_object(
            'url', p.url, 'platform', p.platform,
            'authorName', p.author_name, 'authorHandle', p.author_handle,
            'authorUrl', p.author_url, 'postedAt', p.posted_at, 'text', p.text,
            'image', ${photoOf(sql.literal("p.image"), photoPrefix)},
            'avatar', ${photoOf(sql.literal("p.author_avatar"), photoPrefix)}
          ) ORDER BY p.posted_at, p.id)
          FROM (
            SELECT * FROM event_posts
            WHERE event_id = ev.id AND status = 'approved'
            ORDER BY posted_at, id
            LIMIT ${postLimit}
          ) p
        ), '[]'::json) AS posts,
        (
          SELECT count(*)::int FROM event_posts
          WHERE event_id = ev.id AND status = 'approved'
        ) AS "postCount",
        (
          SELECT ${sql.literal(listingJson)}
          FROM events e
          WHERE ${published(sql, "e")} AND ${ahead(sql, "e", now)}
            AND ${ours(sql, "e")} AND e.id <> ev.id
          ORDER BY ${soonestFirst(sql, "e")}
          LIMIT 1
        ) AS next
      FROM events ev
      WHERE ${draft ? drafts(sql, "ev") : published(sql, "ev")}
        AND ${resolve(sql, "ev", slug)}
      ORDER BY ${linkFirst(sql, "ev", slug)}
      LIMIT 1`,
  });

  const readPage = (slug: string, photoOrigin: string, draft: boolean) =>
    Effect.gen(function* () {
      const now = yield* pageNow;
      const row = yield* orDataSourceError(
        findPage({ slug, now, photoPrefix: `${photoOrigin}/`, draft }),
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(new EventNotFound({ slug }));
      }
      return yield* toEventPage(row.value, now, photoOrigin);
    });

  return EventPages.of({
    read: (slug, photoOrigin) => readPage(slug, photoOrigin, false),
    readDraft: (slug, photoOrigin) => readPage(slug, photoOrigin, true),
  });
});

export class EventPages extends Context.Service<EventPages, EventPagesShape>()(
  "allthings/EventPages",
) {
  static readonly layer = Layer.effect(EventPages, make);
}
