import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { pageNow } from "./clock.ts";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Contract from "./contract.ts";
import { DataSourceError } from "./errors.ts";
import { guestCountFloor } from "./event-page.ts";
import { type Evening, toEvening } from "./home.ts";
import { personLinks } from "./mappers.ts";
import * as Rows from "./rows.ts";
import { listingJson } from "./sql.ts";

/**
 * What the about page says about all things, read as of the `Clock` in one
 * statement: how many evenings it has held and who came, where each of the
 * names it went by first appeared, and its organizers as their profiles
 * have them. Every number is counted from the data, at published evenings
 * that have ended; nothing is typed in.
 */

/**
 * The names the evenings went by before they were all things, oldest
 * first: brand/foundations.md keeps "All Things Web" as history, and the
 * meetups before it are where it began. An evening went by one when its
 * name starts with it, as Luma has it.
 */
export const formerNames = [
  "Remix Bay Area",
  "React Bay Area",
  "All Things Web",
] as const;

export type FormerName = (typeof formerNames)[number];

/** An organizer, as their profile has them. */
export interface Organizer {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly bio: string | null;
  readonly links: Contract.PersonLinks;
  /** Their photo on the photo origin, or null: the blank avatar stands in. */
  readonly photo: Rows.Photo | null;
}

export interface AboutView {
  /** Published evenings that have ended. */
  readonly evenings: number;
  /** Distinct people who have been on stage at them. */
  readonly speakers: number;
  /** Distinct companies that have hosted them. */
  readonly hostingCompanies: number;
  /**
   * Their guests as Luma counted them, counting only evenings with at least
   * {@link guestCountFloor}: smaller counts are artifacts, not attendance.
   */
  readonly guests: number;
  /** The first published evening, if there has been one. */
  readonly first: Evening | undefined;
  /** The first evening under each former name, oldest first. */
  readonly formerNames: ReadonlyArray<{
    readonly name: FormerName;
    readonly evening: Evening;
  }>;
  /** The organizers asked for whose profiles exist, in that order. */
  readonly organizers: ReadonlyArray<Organizer>;
}

const OrganizerRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
  photo: Schema.NullOr(Rows.Photo),
});

/** What the about page reads, in one statement. */
export const AboutRow = Schema.Struct({
  evenings: Schema.Int,
  speakers: Schema.Int,
  hostingCompanies: Schema.Int,
  guests: Schema.Int,
  first: Schema.NullOr(Rows.Listing),
  formerNames: Schema.Array(
    Schema.Struct({
      name: Schema.Literals(formerNames),
      listing: Rows.Listing,
    }),
  ),
  organizers: Schema.Array(OrganizerRow),
});

export type AboutRow = typeof AboutRow.Type;

/** Text as the profile states it, or null when it is blank. */
const known = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};

export function toAbout(row: AboutRow, now: DateTime.Utc): AboutView {
  return {
    evenings: row.evenings,
    speakers: row.speakers,
    hostingCompanies: row.hostingCompanies,
    guests: row.guests,
    first: row.first === null ? undefined : toEvening(row.first, now),
    formerNames: row.formerNames.map(({ name, listing }) => ({
      name,
      evening: toEvening(listing, now),
    })),
    organizers: row.organizers.map((organizer) => ({
      id: organizer.id,
      name: organizer.name,
      title: known(organizer.title),
      bio: known(organizer.bio),
      links: personLinks(organizer),
      photo: organizer.photo,
    })),
  };
}

export interface AboutShape {
  /**
   * The about page as of the `Clock`'s now, with the organizers whose
   * profile ids are given. Photos are taken only from `photoOrigin`, the
   * one origin pages may load images from.
   */
  readonly read: (
    organizerIds: ReadonlyArray<string>,
    photoOrigin: string,
  ) => Effect.Effect<AboutView, DataSourceError>;
}

const Request = Schema.Struct({
  now: Schema.DateTimeUtcFromDate,
  organizerIds: Schema.String,
  names: Schema.String,
  photoPrefix: Schema.String,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // Lists arrive as JSON text, so the statement keeps one shape however
  // many organizers or names it is asked about. "Held" means published and
  // ended; ids break ties between evenings that start together.
  const findAbout = SqlSchema.findOne({
    Request,
    Result: AboutRow,
    execute: ({ now, organizerIds, names, photoPrefix }) => sql`
      WITH held AS (
        SELECT e.* FROM events e
        WHERE e.is_draft = false AND e.end_date < ${now}
      )
      SELECT
        (SELECT count(*)::int FROM held) AS evenings,
        (
          SELECT count(DISTINCT ts.speaker_id)::int
          FROM held e
          JOIN event_talks et ON et.event_id = e.id
          JOIN talk_speakers ts ON ts.talk_id = et.talk_id
        ) AS speakers,
        (
          SELECT count(DISTINCT es.sponsor_id)::int
          FROM held e
          JOIN event_sponsors es ON es.event_id = e.id
        ) AS "hostingCompanies",
        (
          SELECT COALESCE(sum(e.luma_guest_count), 0)::int
          FROM held e
          WHERE e.luma_guest_count >= ${guestCountFloor}
        ) AS guests,
        (
          SELECT ${sql.literal(listingJson)}
          FROM held e
          ORDER BY e.start_date, e.id
          LIMIT 1
        ) AS first,
        COALESCE((
          SELECT json_agg(json_build_object('name', f.name, 'listing', f.listing)
            ORDER BY f.position)
          FROM (
            SELECT DISTINCT ON (n.position) n.name, n.position,
              ${sql.literal(listingJson)} AS listing
            FROM json_array_elements_text(${names}::json)
              WITH ORDINALITY AS n(name, position)
            JOIN held e ON starts_with(lower(e.name), lower(n.name))
            ORDER BY n.position, e.start_date, e.id
          ) f
        ), '[]'::json) AS "formerNames",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', p.id, 'name', p.name, 'title', p.title, 'bio', p.bio,
            'twitterHandle', p.twitter_handle,
            'blueskyHandle', p.bluesky_handle,
            'linkedinHandle', p.linkedin_handle,
            'photo', (
              SELECT json_build_object(
                'url', i.url, 'alt', i.alt, 'width', i.width, 'height', i.height,
                'version', floor(extract(epoch FROM i.updated_at))::bigint::text
              )
              FROM images i
              WHERE i.id = p.image AND starts_with(i.url, ${photoPrefix})
            )
          ) ORDER BY o.position)
          FROM json_array_elements_text(${organizerIds}::json)
            WITH ORDINALITY AS o(id, position)
          JOIN profiles p ON p.id::text = o.id
        ), '[]'::json) AS organizers`,
  });

  return About.of({
    read: (organizerIds, photoOrigin) =>
      Effect.gen(function* () {
        const now = yield* pageNow;
        const row = yield* findAbout({
          now,
          organizerIds: JSON.stringify(organizerIds),
          names: JSON.stringify(formerNames),
          photoPrefix: `${photoOrigin}/`,
        });
        return toAbout(row, now);
      }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  });
});

export class About extends Context.Service<About, AboutShape>()(
  "allthings/About",
) {
  static readonly layer = Layer.effect(About, make);
}
