import {
  hostsOf,
  latestFirst,
  published,
  talkAppearances,
  talksOf,
} from "allthings-core/src/catalog.ts";
import * as Rows from "allthings-core/src/rows.ts";
import { DataSourceError } from "allthings-core/src/errors.ts";
import { Context, DateTime, Effect, Layer, type Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

/**
 * What the v1 API reads: the app's rows as drizzle selects them, every
 * column included, because the v1 responses publish them as they are.
 * Related rows are nested as JSON so each call is a single statement.
 */

// Top-level timestamptz columns decode to Date; nested in JSON they are text.
const Timestamp = Schema.DateTimeUtcFromDate;
const JsonTimestamp = Schema.DateTimeUtcFromString;

/** A row of `images`. */
export const ImageRow = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  placeholder: Schema.String,
  alt: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  createdAt: JsonTimestamp,
  updatedAt: JsonTimestamp,
});

/** A row of `events` with its preview image, if it has one. */
export const EventRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  startDate: Timestamp,
  endDate: Timestamp,
  slug: Schema.String,
  tagline: Schema.String,
  attendeeLimit: Schema.Int,
  streetAddress: Schema.NullOr(Schema.String),
  shortLocation: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  isHackathon: Schema.Boolean,
  isDraft: Schema.Boolean,
  highlightOnLandingPage: Schema.Boolean,
  recordingUrl: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  topic: Schema.NullOr(Schema.String),
  lumaGuestCount: Schema.NullOr(Schema.Int),
  lumaCheckedInCount: Schema.NullOr(Schema.Int),
  program: Rows.EventProgram,
  curation: Schema.Literals(["ours", "shared"]),
  organizedBy: Schema.NullOr(Schema.String),
  lumaDescription: Schema.NullOr(Schema.String),
  lumaSummary: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  shortSlug: Schema.NullOr(Schema.String),
  previewImage: Schema.NullOr(ImageRow),
});

/** The social handles a profile stores; links are built from them. */
const Handles = {
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
};

/** A talk's speaker: a row of `profiles` with its photo. */
export const SpeakerRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  ...Handles,
  image: Schema.NullOr(ImageRow),
});

/** An event with its talks and their speakers, its hosts and its photos. */
export const EventDetailsRow = Schema.Struct({
  ...EventRow.fields,
  talks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      /** Editor HTML as stored. */
      description: Schema.String,
      speakers: Schema.Array(SpeakerRow),
    }),
  ),
  hosts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      about: Schema.String,
      squareLogoLight: Schema.NullOr(ImageRow),
      squareLogoDark: Schema.NullOr(ImageRow),
    }),
  ),
  images: Schema.Array(ImageRow),
});

/** One talk a speaker gave at a published event that has ended. */
export const DirectoryRow = Schema.Struct({
  profile: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    title: Schema.String,
    bio: Schema.String,
    profileType: Schema.Literals(["organizer", "member"]),
    ...Handles,
    image: Schema.NullOr(ImageRow),
  }),
  talkId: Schema.String,
});

export type ImageRow = typeof ImageRow.Type;
export type EventRow = typeof EventRow.Type;
export type SpeakerRow = typeof SpeakerRow.Type;
export type EventDetailsRow = typeof EventDetailsRow.Type;
export type DirectoryRow = typeof DirectoryRow.Type;

export interface V1DataShape {
  /** Published events, latest start first, ties broken by id. */
  readonly listPublishedEvents: Effect.Effect<
    ReadonlyArray<EventRow>,
    DataSourceError
  >;
  /**
   * The published event with this id; `id` must already be a valid
   * Postgres uuid. Talks, speakers, hosts and photos come in attach order.
   */
  readonly findPublishedEvent: (
    id: string,
  ) => Effect.Effect<Option.Option<EventDetailsRow>, DataSourceError>;
  /**
   * One row per speaker and talk given at a published event that has ended by
   * the `Clock`'s now, in the app's order: by name, then newest event first.
   */
  readonly directory: Effect.Effect<
    ReadonlyArray<DirectoryRow>,
    DataSourceError
  >;
}

/** Columns that reference an image, as the queries alias their tables. */
type ImageColumn =
  | "e.preview_image"
  | "p.image"
  | "s.square_logo_light"
  | "s.square_logo_dark";

/** `column`'s image as a JSON object matching `ImageRow`, or NULL. */
const imageJson = (column: ImageColumn) =>
  `(SELECT ${imageObject("i")} FROM images i WHERE i.id = ${column})`;

/** The images row aliased `alias` as a JSON object matching `ImageRow`. */
const imageObject = (alias: "i" | "img") =>
  `json_build_object('id', ${alias}.id, 'url', ${alias}.url, 'placeholder', ${alias}.placeholder, 'alt', ${alias}.alt, 'width', ${alias}.width, 'height', ${alias}.height, 'createdAt', ${alias}.created_at, 'updatedAt', ${alias}.updated_at)`;

const handleColumns = `'twitterHandle', p.twitter_handle, 'blueskyHandle', p.bluesky_handle, 'linkedinHandle', p.linkedin_handle`;

const orDataSourceError = <A, R>(
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, DataSourceError, R> =>
  Effect.mapError(effect, (cause) => new DataSourceError({ cause }));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  const eventColumns = sql.literal(`
    e.id, e.name, e.start_date AS "startDate", e.end_date AS "endDate",
    e.slug, e.tagline, e.attendee_limit AS "attendeeLimit",
    e.street_address AS "streetAddress", e.short_location AS "shortLocation",
    e.full_address AS "fullAddress", e.luma_event_id AS "lumaEventId",
    e.is_hackathon AS "isHackathon", e.is_draft AS "isDraft",
    e.highlight_on_landing_page AS "highlightOnLandingPage",
    e.recording_url AS "recordingUrl",
    e.created_at AS "createdAt", e.updated_at AS "updatedAt", e.topic,
    e.luma_guest_count AS "lumaGuestCount",
    e.luma_checked_in_count AS "lumaCheckedInCount", e.program,
    e.curation, e.organized_by AS "organizedBy", e.short_slug AS "shortSlug",
    e.luma_description AS "lumaDescription", e.luma_summary AS "lumaSummary",
    e.description,
    ${imageJson("e.preview_image")} AS "previewImage"`);

  const listPublished = SqlSchema.findAll({
    Request: Schema.Void,
    Result: EventRow,
    execute: () => sql`
      SELECT ${eventColumns}
      FROM events e
      WHERE ${published(sql, "e")}
      ORDER BY ${latestFirst(sql, "e")}`,
  });

  // The app reads talks, speakers, hosts and photos without ORDER BY; the
  // lineup follows the catalog's order, photos the order they were attached.
  const findById = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: EventDetailsRow,
    execute: (id) => sql`
      SELECT ${eventColumns},
        ${talksOf(sql, "e", {
          talk: sql`'id', t.id, 'title', t.title, 'description', t.description`,
          speaker: sql`json_build_object(
            'id', p.id, 'name', p.name, 'title', p.title, 'bio', p.bio,
            ${sql.literal(handleColumns)},
            'image', ${sql.literal(imageJson("p.image"))}
          )`,
        })} AS talks,
        ${hostsOf(
          sql,
          "e",
          sql`json_build_object(
            'id', s.id,
            'name', s.name,
            'about', s.about,
            'squareLogoLight', ${sql.literal(imageJson("s.square_logo_light"))},
            'squareLogoDark', ${sql.literal(imageJson("s.square_logo_dark"))}
          )`,
        )} AS hosts,
        COALESCE((
          SELECT json_agg(${sql.literal(imageObject("img"))} ORDER BY ei.created_at, img.id)
          FROM event_images ei
          JOIN images img ON img.id = ei.image_id
          WHERE ei.event_id = e.id
        ), '[]'::json) AS images
      FROM events e
      WHERE e.id = ${id}::uuid AND ${published(sql, "e")}`,
  });

  // The app's own query (app/src/lib/speaker-directory.ts), every column
  // kept: the talks core's Speakers lists, in its order.
  const findDirectory = SqlSchema.findAll({
    Request: Schema.DateTimeUtcFromDate,
    Result: DirectoryRow,
    execute: (now) => sql`
      SELECT
        json_build_object(
          'id', p.id, 'name', p.name, 'title', p.title, 'bio', p.bio,
          'profileType', p.profile_type,
          ${sql.literal(handleColumns)},
          'image', ${sql.literal(imageJson("p.image"))}
        ) AS profile,
        t.id AS "talkId"
      FROM ${talkAppearances(sql, {
        whose: "any",
        when: { ended: now },
      })} a
      JOIN profiles p ON p.id = a.profile_id
      JOIN talks t ON t.id = a.talk_id
      JOIN events e ON e.id = a.event_id
      ORDER BY p.name, p.id, ${latestFirst(sql, "e")}, t.id`,
  });

  return V1Data.of({
    listPublishedEvents: orDataSourceError(listPublished(undefined)),
    findPublishedEvent: (id) => orDataSourceError(findById(id)),
    directory: DateTime.now.pipe(
      Effect.flatMap((now) => orDataSourceError(findDirectory(now))),
    ),
  });
});

/** The rows behind the v1 API. */
export class V1Data extends Context.Service<V1Data, V1DataShape>()(
  "allthings/web/V1Data",
) {
  static readonly layer = Layer.effect(V1Data, make);
}
