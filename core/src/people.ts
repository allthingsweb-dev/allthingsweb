import { Context, DateTime, Effect, Layer, Order, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Contract from "./contract.ts";
import { DataSourceError } from "./errors.ts";
import { displayName, eventTopic } from "./lockup.ts";
import { eventStatus, personLinks } from "./mappers.ts";
import * as Rows from "./rows.ts";

/**
 * Who the people page shows, read as of the `Clock`: the organizers first,
 * then everyone who has given or will give a talk at a published evening.
 * Everything shown comes from the people's own profiles; what a profile
 * leaves empty is left out, never filled in.
 */

/** An evening a talk was given at, as a list names it. */
export interface TalkEvening {
  readonly slug: string;
  /** The name as written, without emoji. */
  readonly name: string;
  /** all things/<topic>, by the lockup's rule (see lockup.ts), if any. */
  readonly topic: string | undefined;
  /** At the `Clock`'s now: an upcoming talk carries the cursor. */
  readonly status: Contract.EventStatus;
  readonly startsAt: DateTime.Utc;
}

export interface PersonTalk {
  readonly title: string;
  readonly evening: TalkEvening;
}

export interface Person {
  /** The profile's id: people are told apart by it, never by name. */
  readonly id: string;
  readonly name: string;
  /** Their title as their profile states it, or null when it is empty. */
  readonly title: string | null;
  /** Their bio as their profile states it, or null when it is empty. */
  readonly bio: string | null;
  readonly links: Contract.PersonLinks;
  /** Their photo on the photo origin, or null: the blank avatar stands in. */
  readonly photo: Rows.Photo | null;
  /** Every talk they gave or will give at a published evening, latest first. */
  readonly talks: ReadonlyArray<PersonTalk>;
}

export interface PeopleView {
  /** The organizers whose profiles exist, in the order asked for. */
  readonly organizers: ReadonlyArray<Person>;
  /**
   * Everyone else with a talk: whoever spoke (or speaks) most recently
   * first, then by name, then by id, so the order never depends on the
   * database. The organizers' own talks are listed with them, not here.
   */
  readonly speakers: ReadonlyArray<Person>;
}

/** One talk at one published evening, as the statement nests it. */
export const TalkRow = Schema.Struct({
  title: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  startDate: Schema.DateTimeUtcFromString,
  endDate: Schema.DateTimeUtcFromString,
});

/** A profile with its photo on the photo origin, if any, and its talks. */
export const PersonRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
  photo: Schema.NullOr(Rows.Photo),
  talks: Schema.Array(TalkRow),
});

export type TalkRow = typeof TalkRow.Type;
export type PersonRow = typeof PersonRow.Type;

/**
 * Text as a profile states it, without the space around it (zero-width
 * spaces pasted from elsewhere included); empty or blank reads as unknown.
 */
function known(text: string): string | null {
  const trimmed = text.replace(/^[\s\u200B\uFEFF]+|[\s\u200B\uFEFF]+$/g, "");
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

export function toPerson(row: PersonRow, now: DateTime.Utc): Person {
  return {
    id: row.id,
    name: row.name,
    title: known(row.title),
    bio: known(row.bio),
    links: personLinks(row),
    photo: row.photo,
    talks: row.talks.map((talk) => ({
      title: talk.title,
      evening: {
        slug: talk.slug,
        name: displayName(talk.name),
        topic: eventTopic(talk),
        status: eventStatus(talk, now),
        startsAt: talk.startDate,
      },
    })),
  };
}

/** When a person last spoke, or will next: their latest talk's start. */
const latestTalk = (person: Person): number =>
  person.talks.reduce(
    (latest, talk) =>
      Math.max(latest, DateTime.toEpochMillis(talk.evening.startsAt)),
    Number.NEGATIVE_INFINITY,
  );

const speakerOrder: Order.Order<Person> = Order.combineAll([
  Order.flip(Order.mapInput(Order.Number, latestTalk)),
  Order.mapInput(Order.String, (person: Person) => person.name),
  Order.mapInput(Order.String, (person: Person) => person.id),
]);

/**
 * The page's people from the statement's rows: the organizers in the order
 * of `organizerIds`, then everyone else with a talk.
 */
export function toPeople(
  rows: ReadonlyArray<PersonRow>,
  organizerIds: ReadonlyArray<string>,
  now: DateTime.Utc,
): PeopleView {
  const people = rows.map((row) => toPerson(row, now));
  const byId = new Map(people.map((person) => [person.id, person] as const));
  return {
    organizers: organizerIds.flatMap((id) => {
      const person = byId.get(id);
      return person === undefined ? [] : [person];
    }),
    speakers: people
      .filter(
        (person) =>
          !organizerIds.includes(person.id) && person.talks.length > 0,
      )
      .toSorted(speakerOrder),
  };
}

export interface PeopleShape {
  /**
   * The organizers with these profile ids, then every speaker, as of the
   * `Clock`'s now. Photos are taken only from `photoOrigin` (such as
   * "https://media.allthings.dev"), the one origin pages may load images
   * from.
   */
  readonly read: (
    organizerIds: ReadonlyArray<string>,
    photoOrigin: string,
  ) => Effect.Effect<PeopleView, DataSourceError>;
}

const Request = Schema.Struct({
  organizerIds: Schema.NonEmptyArray(Schema.String),
  photoPrefix: Schema.String,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // One row per person: the organizers asked for, and everyone with a talk
  // at a published evening, each with their talks nested latest first (ids
  // break ties). The join tables' keys make each appearance one row.
  const findPeople = SqlSchema.findAll({
    Request,
    Result: PersonRow,
    execute: ({ organizerIds, photoPrefix }) => sql`
      WITH appearances AS (
        SELECT ts.speaker_id, t.id AS talk_id, t.title,
          e.id AS event_id, e.slug, e.name, e.topic, e.start_date, e.end_date
        FROM talk_speakers ts
        JOIN talks t ON t.id = ts.talk_id
        JOIN event_talks et ON et.talk_id = t.id
        JOIN events e ON e.id = et.event_id
        WHERE e.is_draft = false
      )
      SELECT p.id, p.name, p.title, p.bio,
        p.twitter_handle AS "twitterHandle",
        p.bluesky_handle AS "blueskyHandle",
        p.linkedin_handle AS "linkedinHandle",
        (
          SELECT json_build_object(
            'url', i.url, 'alt', i.alt, 'width', i.width, 'height', i.height
          )
          FROM images i
          WHERE i.id = p.image AND starts_with(i.url, ${photoPrefix})
        ) AS photo,
        COALESCE((
          SELECT json_agg(json_build_object(
            'title', a.title, 'slug', a.slug, 'name', a.name, 'topic', a.topic,
            'startDate', a.start_date, 'endDate', a.end_date
          ) ORDER BY a.start_date DESC, a.event_id, a.talk_id)
          FROM appearances a
          WHERE a.speaker_id = p.id
        ), '[]'::json) AS talks
      FROM profiles p
      WHERE p.id IN ${sql.in(organizerIds)}
        OR EXISTS (SELECT 1 FROM appearances a WHERE a.speaker_id = p.id)
      ORDER BY p.id`,
  });

  return People.of({
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
        });
        return toPeople(rows, organizerIds, now);
      }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  });
});

export class People extends Context.Service<People, PeopleShape>()(
  "allthings/People",
) {
  static readonly layer = Layer.effect(People, make);
}
