import { Context, DateTime, Duration, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type { DataSourceError } from "./errors.ts";
import { eventTopic } from "./lockup.ts";
import { defaultTagline } from "./luma/sync.ts";
import { eventStatus, httpUrlOrNull } from "./mappers.ts";
import * as Rows from "./rows.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * What each published event's record lacks: talks, the people around it and
 * what is known about them, hosts, photos, venue, lockup. A pure function
 * over what the database holds ({@link completeness}), read in one
 * statement ({@link Completeness}), so the same rows always give the same
 * report. Nothing here reads text for meaning: a description's tense, say,
 * is not judged.
 */

/** Everything a gap can be about, with whether a complete record needs it. */
export const gapKinds = {
  /**
   * Only an evening of talks is asked for them: an open floor, a social
   * evening and a hackathon never had a lineup.
   */
  talks: { required: true, label: "no talks" },
  "talk-speakers": { required: true, label: "talk without speakers" },
  "talk-description": { required: true, label: "talk without description" },
  people: { required: true, label: "no organizers, co-hosts or MC" },
  organizer: { required: true, label: "no organizer" },
  "person-title": { required: true, label: "person without title" },
  "person-bio": { required: true, label: "person without bio" },
  "person-photo": { required: true, label: "person without photo" },
  "person-links": { required: false, label: "person without links" },
  hosts: { required: true, label: "no hosting company" },
  "host-logo": { required: true, label: "host without logo" },
  "host-about": { required: true, label: "host without about" },
  "host-website": { required: false, label: "host without website" },
  "host-links": {
    required: false,
    label: "host without X, Bluesky or LinkedIn",
  },
  photos: { required: true, label: "no photos" },
  venue: { required: true, label: "no venue address" },
  topic: { required: true, label: "no topic for the lockup" },
  tagline: { required: true, label: "Luma's placeholder tagline" },
  cover: { required: false, label: "no cover image" },
  recording: { required: false, label: "no recording link" },
  "guest-count": { required: false, label: "no guest count from Luma" },
} as const satisfies Record<
  string,
  { readonly required: boolean; readonly label: string }
>;

export type GapKind = keyof typeof gapKinds;

/** One thing an event's record lacks; `subject` names the talk, person or host. */
export interface Gap {
  readonly kind: GapKind;
  readonly subject: string | null;
}

/** A person as the report checks them. */
const Person = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  hasPhoto: Schema.Boolean,
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
});

/** A published event, with what the report checks, as one row. */
export const EventRecord = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  tagline: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  streetAddress: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  recordingUrl: Schema.NullOr(Schema.String),
  program: Rows.EventProgram,
  hasCover: Schema.Boolean,
  lumaGuestCount: Schema.NullOr(Schema.Int),
  photos: Schema.Int,
  talks: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      description: Schema.String,
      speakers: Schema.Array(Person),
    }),
  ),
  hosts: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      about: Schema.String,
      hasLogo: Schema.Boolean,
      websiteUrl: Schema.NullOr(Schema.String),
      twitterHandle: Schema.NullOr(Schema.String),
      blueskyHandle: Schema.NullOr(Schema.String),
      linkedinHandle: Schema.NullOr(Schema.String),
    }),
  ),
  people: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["organizer", "co-host", "mc"]),
      person: Person,
    }),
  ),
});
export type EventRecord = typeof EventRecord.Type;

/** One event's report. */
export interface EventCompleteness {
  readonly slug: string;
  readonly name: string;
  readonly status: "upcoming" | "live" | "past";
  /** What kind of evening it is, which decides whether talks are asked for. */
  readonly program: Rows.EventProgram;
  readonly startDate: DateTime.Utc;
  readonly endDate: DateTime.Utc;
  readonly talks: number;
  readonly speakers: number;
  readonly people: number;
  readonly hosts: number;
  readonly photos: number;
  readonly guests: number | null;
  readonly gaps: ReadonlyArray<Gap>;
}

/** Blank, or only whitespace and empty markup such as `<p></p>`. */
const isBlank = (text: string): boolean =>
  text.replace(/<[^>]*>|&nbsp;|\s/gu, "") === "";

const gap = (kind: GapKind, subject: string | null = null): Gap => ({
  kind,
  subject,
});

/** What one event's record lacks, at `now`. */
export function eventCompleteness(
  event: EventRecord,
  now: DateTime.Utc,
): EventCompleteness {
  const status = eventStatus(event, now);
  const gaps: Array<Gap> = [];

  if (event.talks.length === 0 && event.program === "talks") {
    gaps.push(gap("talks"));
  }
  for (const talk of event.talks) {
    if (talk.speakers.length === 0) {
      gaps.push(gap("talk-speakers", talk.title));
    }
    if (isBlank(talk.description)) {
      gaps.push(gap("talk-description", talk.title));
    }
  }

  if (event.people.length === 0) gaps.push(gap("people"));
  else if (!event.people.some(({ role }) => role === "organizer")) {
    gaps.push(gap("organizer"));
  }

  // Everyone named on the event, once each: speakers first, as listed.
  const everyone = new Map<string, typeof Person.Type>();
  for (const person of [
    ...event.talks.flatMap((talk) => talk.speakers),
    ...event.people.map((entry) => entry.person),
  ]) {
    if (!everyone.has(person.id)) everyone.set(person.id, person);
  }
  for (const person of everyone.values()) {
    if (isBlank(person.title)) gaps.push(gap("person-title", person.name));
    if (isBlank(person.bio)) gaps.push(gap("person-bio", person.name));
    if (!person.hasPhoto) gaps.push(gap("person-photo", person.name));
    const links = [
      person.twitterHandle,
      person.blueskyHandle,
      person.linkedinHandle,
    ];
    if (links.every((handle) => handle === null || isBlank(handle))) {
      gaps.push(gap("person-links", person.name));
    }
  }

  if (event.hosts.length === 0) gaps.push(gap("hosts"));
  for (const host of event.hosts) {
    if (!host.hasLogo) gaps.push(gap("host-logo", host.name));
    if (isBlank(host.about)) gaps.push(gap("host-about", host.name));
    // A stored value that is no http(s) URL is never linked, so it counts
    // as none.
    if (httpUrlOrNull(host.websiteUrl) === null) {
      gaps.push(gap("host-website", host.name));
    }
    const links = [host.twitterHandle, host.blueskyHandle, host.linkedinHandle];
    if (links.every((handle) => handle === null || isBlank(handle))) {
      gaps.push(gap("host-links", host.name));
    }
  }

  const address = event.fullAddress ?? event.streetAddress;
  if (address === null || isBlank(address)) gaps.push(gap("venue"));
  if (eventTopic(event) === undefined) gaps.push(gap("topic"));
  if (event.tagline.trim() === defaultTagline || isBlank(event.tagline)) {
    gaps.push(gap("tagline"));
  }
  if (!event.hasCover) gaps.push(gap("cover"));

  if (status === "past") {
    if (event.photos === 0) gaps.push(gap("photos"));
    // A stored value that is no http(s) URL is never published, so it counts
    // as none.
    if (httpUrlOrNull(event.recordingUrl) === null) {
      gaps.push(gap("recording"));
    }
    if (event.lumaEventId !== null && event.lumaGuestCount === null) {
      gaps.push(gap("guest-count"));
    }
  }

  return {
    slug: event.slug,
    name: event.name,
    status,
    program: event.program,
    startDate: event.startDate,
    endDate: event.endDate,
    talks: event.talks.length,
    speakers: new Set(
      event.talks.flatMap((talk) => talk.speakers.map((s) => s.id)),
    ).size,
    people: event.people.length,
    hosts: event.hosts.length,
    photos: event.photos,
    guests: event.lumaGuestCount,
    gaps,
  };
}

/** Every event's report, in the order given (latest start first, as read). */
export const completeness = (
  events: ReadonlyArray<EventRecord>,
  now: DateTime.Utc,
): ReadonlyArray<EventCompleteness> =>
  events.map((event) => eventCompleteness(event, now));

/** Gaps a complete record cannot have. */
export const requiredGaps = (report: EventCompleteness): ReadonlyArray<Gap> =>
  report.gaps.filter((g) => gapKinds[g.kind].required);

/** How far back {@link mustHaveTalks} looks by default. */
export const recentWindow = Duration.days(30);

/**
 * Events that ended within `window` before `now` and have no talks: what a
 * weekly check fails on. Events further back are reported but don't fail
 * it, so one old gap can't keep the check red for good.
 */
export function mustHaveTalks(
  reports: ReadonlyArray<EventCompleteness>,
  now: DateTime.Utc,
  window: Duration.Duration = recentWindow,
): ReadonlyArray<EventCompleteness> {
  const since = DateTime.subtractDuration(now, window);
  return reports.filter(
    (report) =>
      report.status === "past" &&
      DateTime.isGreaterThanOrEqualTo(report.endDate, since) &&
      report.gaps.some((g) => g.kind === "talks"),
  );
}

export interface CompletenessShape {
  /** Every published event's report at the `Clock`'s now, latest first. */
  readonly report: Effect.Effect<
    ReadonlyArray<EventCompleteness>,
    DataSourceError
  >;
}

/** The profile aliased `p`, as a JSON object matching `Person`. */
const personJson = `json_build_object('id', p.id, 'name', p.name, 'title', p.title, 'bio', p.bio, 'hasPhoto', p.image IS NOT NULL, 'twitterHandle', p.twitter_handle, 'blueskyHandle', p.bluesky_handle, 'linkedinHandle', p.linkedin_handle)`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // In each list's attach order, as the event page shows it; people by role
  // and position. Ties break on ids, so the report never reorders.
  const findAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: EventRecord,
    execute: () => sql`
      SELECT e.slug, e.name, e.topic, e.tagline,
        e.start_date AS "startDate", e.end_date AS "endDate",
        e.street_address AS "streetAddress", e.full_address AS "fullAddress",
        e.luma_event_id AS "lumaEventId", e.recording_url AS "recordingUrl",
        e.program,
        e.preview_image IS NOT NULL AS "hasCover",
        e.luma_guest_count AS "lumaGuestCount",
        (SELECT count(*)::int FROM event_images ei WHERE ei.event_id = e.id) AS photos,
        COALESCE((
          SELECT json_agg(json_build_object(
            'title', t.title,
            'description', t.description,
            'speakers', COALESCE((
              SELECT json_agg(${sql.literal(personJson)} ORDER BY ts.created_at, p.id)
              FROM talk_speakers ts
              JOIN profiles p ON p.id = ts.speaker_id
              WHERE ts.talk_id = t.id
            ), '[]'::json)
          ) ORDER BY et.created_at, t.id)
          FROM event_talks et
          JOIN talks t ON t.id = et.talk_id
          WHERE et.event_id = e.id
        ), '[]'::json) AS talks,
        COALESCE((
          SELECT json_agg(json_build_object(
            'name', s.name,
            'about', s.about,
            'hasLogo', s.square_logo_light IS NOT NULL OR s.square_logo_dark IS NOT NULL,
            'websiteUrl', s.website_url,
            'twitterHandle', s.twitter_handle,
            'blueskyHandle', s.bluesky_handle,
            'linkedinHandle', s.linkedin_handle
          ) ORDER BY es.created_at, s.id)
          FROM event_sponsors es
          JOIN sponsors s ON s.id = es.sponsor_id
          WHERE es.event_id = e.id
        ), '[]'::json) AS hosts,
        COALESCE((
          SELECT json_agg(json_build_object(
            'role', ep.role,
            'person', ${sql.literal(personJson)}
          ) ORDER BY array_position(ARRAY['organizer', 'co-host', 'mc'], ep.role),
            ep.position, ep.created_at, p.id)
          FROM event_people ep
          JOIN profiles p ON p.id = ep.profile_id
          WHERE ep.event_id = e.id
        ), '[]'::json) AS people
      FROM events e
      WHERE e.is_draft = false
      ORDER BY e.start_date DESC, e.id`,
  });

  return Completeness.of({
    report: Effect.gen(function* () {
      const events = yield* orDataSourceError(findAll(undefined));
      return completeness(events, yield* DateTime.now);
    }),
  });
});

export class Completeness extends Context.Service<
  Completeness,
  CompletenessShape
>()("allthings/Completeness") {
  static readonly layer = Layer.effect(Completeness, make);
}
