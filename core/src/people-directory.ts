import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Order,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Contract from "./contract.ts";
import { DataSourceError } from "./errors.ts";
import { displayName, eventTopic } from "./lockup.ts";
import { eventStatus, personLinks } from "./mappers.ts";
import { type StageRole, stageRole } from "./people.ts";
import * as Rows from "./rows.ts";
import { byFollowers } from "./followers.ts";
import { siteSlug } from "./sql.ts";

/**
 * Who the people page shows, read as of the `Clock`: the organizers first,
 * then everyone who has been or will be on stage at one of our published
 * evenings, then everyone who co-hosted or MC'd one without a talk. People
 * from evenings we only share are in the network, on those evenings' pages,
 * but not here. Everything shown
 * comes from the people's own profiles and the evenings they took part in;
 * what a profile leaves empty is left out, never filled in.
 */

/** An evening someone took part in, as a list names it. */
export interface PartEvening {
  readonly slug: string;
  /** Ours, or someone else's we shared (only a person's own page lists those). */
  readonly curation: "ours" | "shared";
  /** The name as written, without emoji. */
  readonly name: string;
  /** all things/<topic>, by the lockup's rule (see lockup.ts), if any. */
  readonly topic: string | undefined;
  /** At the `Clock`'s now: an evening still ahead carries the cursor. */
  readonly status: Contract.EventStatus;
  readonly startsAt: DateTime.Utc;
}

/** A person's event roles the page names; organizing is its own group. */
export type EveningRole = "co-host" | "mc";

/**
 * One way a person took part in one evening: a talk, in their capacity on
 * stage (see people.ts), or a part in the evening as a whole.
 */
export type Part =
  | {
      readonly kind: "talk";
      readonly title: string;
      readonly role: StageRole;
      readonly evening: PartEvening;
    }
  | {
      readonly kind: "role";
      readonly role: EveningRole;
      readonly evening: PartEvening;
    };

export interface Person {
  /** The profile's id: people are told apart by it, never by name. */
  readonly id: string;
  /** Their page's address, /people/<slug> (see person-slug.ts). */
  readonly slug: string;
  readonly name: string;
  /** Their title as their profile states it, or null when it is empty. */
  readonly title: string | null;
  /** Their bio as their profile states it, or null when it is empty. */
  readonly bio: string | null;
  readonly links: Contract.PersonLinks;
  /** Their photo on the photo origin, or null: the blank avatar stands in. */
  readonly photo: Rows.Photo | null;
  /**
   * Their talks, and the evenings they co-hosted or MC'd, at published
   * evenings: latest evening first, an evening's talks before its roles.
   */
  readonly parts: ReadonlyArray<Part>;
}

/**
 * One person's own page: everything the directory says of them, at every
 * published evening (ours and shared), and, for an organizer, the evenings
 * they hosted, latest first.
 */
export interface PersonPage extends Person {
  readonly organizes: boolean;
  readonly hosted: ReadonlyArray<PartEvening>;
}

/** What /people/<slug> finds: a person, the person it moved to, or no one. */
export type PersonLookup =
  | { readonly kind: "found"; readonly person: PersonPage }
  | { readonly kind: "moved"; readonly slug: string }
  | { readonly kind: "none" };

export interface PeopleView {
  /**
   * The organizers asked for whose profiles exist, in that order, then
   * anyone else an evening names as its organizer.
   */
  readonly organizers: ReadonlyArray<Person>;
  /** Everyone else with a talk. */
  readonly speakers: ReadonlyArray<Person>;
  /** Everyone else who co-hosted or MC'd an evening, without a talk. */
  readonly coHosts: ReadonlyArray<Person>;
}

const EveningColumns = {
  slug: Schema.String,
  curation: Schema.Literals(["ours", "shared"]),
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  startDate: Schema.DateTimeUtcFromString,
  endDate: Schema.DateTimeUtcFromString,
};

/** One talk at one published evening, as the statement nests it. */
export const TalkRow = Schema.Struct({
  title: Schema.String,
  format: Rows.TalkFormat,
  role: Rows.SpeakerRole,
  ...EveningColumns,
});

/** One co-host or MC part at one published evening. */
export const RoleRow = Schema.Struct({
  role: Schema.Literals(["co-host", "mc"]),
  ...EveningColumns,
});

/** An evening someone organized. */
export const HostedRow = Schema.Struct(EveningColumns);

/** A profile with its photo on the photo origin, if any, and its parts. */
export const PersonRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
  /** How many follow them on X, as last read (src/followers.ts). */
  xFollowers: Schema.NullOr(Schema.Int),
  photo: Schema.NullOr(Rows.Photo),
  /** Whether a published evening names them as an organizer. */
  organizes: Schema.Boolean,
  talks: Schema.Array(TalkRow),
  roles: Schema.Array(RoleRow),
  /** The evenings they organized, latest first. */
  hosted: Schema.Array(HostedRow),
});

export type TalkRow = typeof TalkRow.Type;
export type RoleRow = typeof RoleRow.Type;
export type PersonRow = typeof PersonRow.Type;

/**
 * Text as a profile states it, without the space around it (zero-width
 * spaces pasted from elsewhere included); empty or blank reads as unknown.
 */
function known(text: string): string | null {
  const trimmed = text.replace(/^[\s​﻿]+|[\s​﻿]+$/g, "");
  return trimmed === "" ? null : trimmed;
}

/** A short bio is at least this long, unless the whole bio is shorter. */
export const shortBioLength = 60;

/** Abbreviations whose period ends no sentence. */
const abbreviation =
  /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|e\.g|i\.e|etc|Inc|Co|Ltd|U\.S)\.$/;

/**
 * The bio's opening sentences, as written, up to the first sentence end at
 * or past {@link shortBioLength} characters; the whole bio when it has no
 * such end. A sentence ends at ".", "!" or "?" before a space and a capital
 * letter, digit or opening quote, but not after an abbreviation such as
 * "Dr.". Nothing is reworded or added: the speakers list shows this, and
 * a speaker's whole bio stays on their profile.
 */
export function shortBio(bio: string): string {
  const ends = /[.!?](?=\s+["“(]?[\p{Lu}0-9])/gu;
  for (const end of bio.matchAll(ends)) {
    const head = bio.slice(0, end.index + 1);
    if (head.length >= shortBioLength && !abbreviation.test(head)) return head;
  }
  return bio;
}

const partEvening = (
  row: typeof HostedRow.Type,
  now: DateTime.Utc,
): PartEvening => ({
  slug: row.slug,
  curation: row.curation,
  name: displayName(row.name),
  topic: eventTopic({ ...row, curation: { kind: row.curation } }),
  status: eventStatus(row, now),
  startsAt: row.startDate,
});

/** Latest evening first; on one evening, its talks before its roles. */
const partOrder: Order.Order<Part> = Order.combineAll([
  Order.flip(
    Order.mapInput(DateTime.Order, (part: Part) => part.evening.startsAt),
  ),
  Order.mapInput(Order.String, (part: Part) => part.evening.slug),
  Order.mapInput(Order.Number, (part: Part) => (part.kind === "talk" ? 0 : 1)),
]);

export function toPerson(row: PersonRow, now: DateTime.Utc): Person {
  const talks = row.talks.map(
    (talk): Part => ({
      kind: "talk",
      title: talk.title,
      role: stageRole(talk.format, talk.role),
      evening: partEvening(talk, now),
    }),
  );
  const roles = row.roles.map(
    (role): Part => ({
      kind: "role",
      role: role.role,
      evening: partEvening(role, now),
    }),
  );
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    title: known(row.title),
    bio: known(row.bio),
    links: personLinks(row),
    photo: row.photo,
    // Each list arrives in its order; sorting is stable, so it keeps it
    // between talks at one evening.
    parts: [...talks, ...roles].toSorted(partOrder),
  };
}

/** When a person last took part, or next will: their latest evening's start. */
const latestPart = (person: Person): number =>
  person.parts.reduce(
    (latest, part) =>
      Math.max(latest, DateTime.toEpochMillis(part.evening.startsAt)),
    Number.NEGATIVE_INFINITY,
  );

/** Whoever took part most recently first, then by name, then by id. */
const personOrder: Order.Order<Person> = Order.combineAll([
  Order.flip(Order.mapInput(Order.Number, latestPart)),
  Order.mapInput(Order.String, (person: Person) => person.name),
  Order.mapInput(Order.String, (person: Person) => person.id),
]);

/**
 * The page's people from the statement's rows: the organizers in the order
 * of `organizerIds`, then the other organizers, then everyone else with a
 * talk, then everyone else who co-hosted or MC'd. Speakers are ordered by
 * how many follow them on X, most first (src/followers.ts); among equal
 * counts, among those without one, and within the other groups (but the
 * organizers asked for), whoever took part most recently comes first.
 */
export function toPeople(
  rows: ReadonlyArray<PersonRow>,
  organizerIds: ReadonlyArray<string>,
  now: DateTime.Utc,
): PeopleView {
  const asked = new Set(organizerIds);
  const followers = new Map(rows.map((row) => [row.id, row.xFollowers]));
  const people = rows.map((row) => ({
    person: toPerson(row, now),
    organizes: row.organizes,
  }));
  const byId = new Map(
    people.map(({ person }) => [person.id, person] as const),
  );
  const others = people.filter(({ person }) => !asked.has(person.id));
  const group = (keep: (entry: (typeof people)[number]) => boolean) =>
    others
      .filter(keep)
      .map(({ person }) => person)
      .toSorted(personOrder);
  const hasTalk = (person: Person) =>
    person.parts.some((part) => part.kind === "talk");
  return {
    organizers: [
      ...organizerIds.flatMap((id) => {
        const person = byId.get(id);
        return person === undefined ? [] : [person];
      }),
      ...group(({ organizes }) => organizes),
    ],
    speakers: others
      .filter(({ person, organizes }) => !organizes && hasTalk(person))
      .map(({ person }) => person)
      .toSorted(
        byFollowers((person) => followers.get(person.id) ?? null, personOrder),
      ),
    coHosts: group(
      ({ person, organizes }) =>
        !organizes && !hasTalk(person) && person.parts.length > 0,
    ),
  };
}

/** A person's own page from their row (see {@link PersonPage}). */
export const toPersonPage = (
  row: PersonRow,
  now: DateTime.Utc,
): PersonPage => ({
  ...toPerson(row, now),
  organizes: row.organizes,
  hosted: row.hosted.map((evening) => partEvening(evening, now)),
});

export interface PeopleDirectoryShape {
  /**
   * The organizers with these profile ids, then everyone else who took part
   * in a published evening, as of the `Clock`'s now. Photos are taken only
   * from `photoOrigin` (such as "https://media.allthings.dev"), the one
   * origin pages may load images from.
   */
  readonly read: (
    organizerIds: ReadonlyArray<string>,
    photoOrigin: string,
  ) => Effect.Effect<PeopleView, DataSourceError>;
  /**
   * The person at /people/`slug`, as of the `Clock`'s now; or, for a slug
   * they had before, their current one; or no one.
   */
  readonly person: (
    slug: string,
    photoOrigin: string,
  ) => Effect.Effect<PersonLookup, DataSourceError>;
}

const Request = Schema.Struct({
  organizerIds: Schema.NonEmptyArray(Schema.String),
  photoPrefix: Schema.String,
  /** One person's page, by slug, at every published evening; or null. */
  slug: Schema.NullOr(Schema.String),
});

const MovedRequest = Schema.Struct({ slug: Schema.String });
const MovedRow = Schema.Struct({ slug: Schema.String });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // One row per person: the organizers asked for, and everyone with a talk
  // or a part in one of our published evenings, each with their talks, their
  // co-host and MC parts and the evenings they organized nested latest first
  // (ids break ties). The join tables' keys make each talk and each part one
  // row. With a slug, the one person who has it, at every published evening
  // (shared ones too), whether or not they took part in any.
  const findPeople = SqlSchema.findAll({
    Request,
    Result: PersonRow,
    execute: ({ organizerIds, photoPrefix, slug }) => sql`
      WITH talks_given AS (
        SELECT ts.speaker_id AS profile_id, ts.role, t.id AS talk_id,
          t.title, t.format,
          e.id AS event_id, ${sql.literal(siteSlug("e"))} AS slug, e.curation,
          e.name, e.topic,
          e.start_date, e.end_date
        FROM talk_speakers ts
        JOIN talks t ON t.id = ts.talk_id
        JOIN event_talks et ON et.talk_id = t.id
        JOIN events e ON e.id = et.event_id
        WHERE e.is_draft = false
          AND (e.curation = 'ours' OR ${slug}::text IS NOT NULL)
      ),
      parts AS (
        SELECT ep.profile_id, ep.role,
          e.id AS event_id, ${sql.literal(siteSlug("e"))} AS slug, e.curation,
          e.name, e.topic,
          e.start_date, e.end_date
        FROM event_people ep
        JOIN events e ON e.id = ep.event_id
        WHERE e.is_draft = false
          AND (e.curation = 'ours' OR ${slug}::text IS NOT NULL)
      )
      SELECT p.id, p.slug, p.name, p.title, p.bio,
        p.twitter_handle AS "twitterHandle",
        p.bluesky_handle AS "blueskyHandle",
        p.linkedin_handle AS "linkedinHandle",
        p.x_followers AS "xFollowers",
        (
          SELECT json_build_object(
            'url', i.url, 'alt', i.alt, 'width', i.width, 'height', i.height,
            'version', floor(extract(epoch FROM i.updated_at))::bigint::text
          )
          FROM images i
          WHERE i.id = p.image AND starts_with(i.url, ${photoPrefix})
        ) AS photo,
        EXISTS (
          SELECT 1 FROM parts x
          WHERE x.profile_id = p.id AND x.role = 'organizer'
        ) AS organizes,
        COALESCE((
          SELECT json_agg(json_build_object(
            'title', g.title, 'format', g.format, 'role', g.role,
            'slug', g.slug, 'curation', g.curation, 'name', g.name,
            'topic', g.topic,
            'startDate', g.start_date, 'endDate', g.end_date
          ) ORDER BY g.start_date DESC, g.event_id, g.talk_id)
          FROM talks_given g
          WHERE g.profile_id = p.id
        ), '[]'::json) AS talks,
        COALESCE((
          SELECT json_agg(json_build_object(
            'role', x.role, 'slug', x.slug, 'curation', x.curation,
            'name', x.name, 'topic', x.topic,
            'startDate', x.start_date, 'endDate', x.end_date
          ) ORDER BY x.start_date DESC, x.event_id, x.role)
          FROM parts x
          WHERE x.profile_id = p.id AND x.role IN ('co-host', 'mc')
        ), '[]'::json) AS roles,
        COALESCE((
          SELECT json_agg(json_build_object(
            'slug', x.slug, 'curation', x.curation, 'name', x.name,
            'topic', x.topic,
            'startDate', x.start_date, 'endDate', x.end_date
          ) ORDER BY x.start_date DESC, x.event_id)
          FROM parts x
          WHERE x.profile_id = p.id AND x.role = 'organizer'
        ), '[]'::json) AS hosted
      FROM profiles p
      WHERE (${slug}::text IS NULL AND (
          p.id IN ${sql.in(organizerIds)}
          OR EXISTS (SELECT 1 FROM talks_given g WHERE g.profile_id = p.id)
          OR EXISTS (SELECT 1 FROM parts x WHERE x.profile_id = p.id)
        ))
        OR p.slug = ${slug}
      ORDER BY p.id`,
  });

  // A slug someone had before: theirs now, unless someone else has it now.
  const findMoved = SqlSchema.findOneOption({
    Request: MovedRequest,
    Result: MovedRow,
    execute: ({ slug }) => sql`
      SELECT p.slug
      FROM profile_slugs ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE ps.slug = ${slug}
        AND NOT EXISTS (SELECT 1 FROM profiles q WHERE q.slug = ${slug})`,
  });

  return PeopleDirectory.of({
    read: (organizerIds, photoOrigin) =>
      Effect.gen(function* () {
        const [first, ...rest] = organizerIds;
        const now = yield* DateTime.now;
        // Without organizers to ask for, an id no profile has keeps the
        // statement one shape.
        const rows = yield* findPeople({
          organizerIds:
            first === undefined
              ? ["00000000-0000-0000-0000-000000000000"]
              : [first, ...rest],
          photoPrefix: `${photoOrigin}/`,
          slug: null,
        });
        return toPeople(rows, organizerIds, now);
      }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
    person: (slug, photoOrigin) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const [row] = yield* findPeople({
          // No one is asked for by id: only the slug finds them.
          organizerIds: ["00000000-0000-0000-0000-000000000000"],
          photoPrefix: `${photoOrigin}/`,
          slug,
        });
        if (row !== undefined) {
          return { kind: "found", person: toPersonPage(row, now) } as const;
        }
        const moved = yield* findMoved({ slug });
        return Option.match(moved, {
          onNone: () => ({ kind: "none" }) as const,
          onSome: (to) => ({ kind: "moved", slug: to.slug }) as const,
        });
      }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  });
});

export class PeopleDirectory extends Context.Service<
  PeopleDirectory,
  PeopleDirectoryShape
>()("allthings/PeopleDirectory") {
  static readonly layer = Layer.effect(PeopleDirectory, make);
}
