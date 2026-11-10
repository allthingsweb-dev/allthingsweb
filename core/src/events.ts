import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { asOf } from "./clock.ts";
import {
  hostsOf,
  latestFirst,
  linkFirst,
  peopleOf,
  publicVenue,
  published,
  resolve,
  talksOf,
} from "./catalog.ts";
import { type DataSourceError, EventNotFound } from "./errors.ts";
import * as Rows from "./rows.ts";
import {
  curationJson,
  imageJson,
  orDataSourceError,
  profileJson,
} from "./sql.ts";

/**
 * Published events, as of the `Clock`'s now (src/clock.ts). Drafts never
 * leave this service: they are filtered in SQL, and a draft's slug is
 * reported as not found, as the app does today. Each venue is as public
 * surfaces may say it (catalog.ts, `publicVenue`).
 */
export interface EventsShape {
  /** Every published event, latest start first. */
  readonly listPublished: Effect.Effect<
    ReadonlyArray<Rows.Event>,
    DataSourceError
  >;
  /**
   * One published event with its talks and their speakers, its hosts, its
   * people (organizers, co-hosts, MC) and its photos, by any link it has
   * or had: its long slug, its short link, or one it had before.
   */
  readonly getPublished: (
    slug: string,
  ) => Effect.Effect<Rows.EventDetails, EventNotFound | DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  /** The event's columns, its venue as public surfaces may say it at `now`. */
  const eventColumns = (now: Date) => sql`
    e.id, e.slug, e.name, e.tagline,
    e.start_date AS "startDate", e.end_date AS "endDate",
    ${publicVenue(sql, "e", now, "columns")},
    e.luma_event_id AS "lumaEventId",
    e.recording_url AS "recordingUrl", e.is_hackathon AS "isHackathon",
    ${sql.literal(imageJson("e.preview_image"))} AS "previewImage",
    ${sql.literal(curationJson("e"))} AS curation`;

  const listPublished = SqlSchema.findAll({
    Request: Schema.DateTimeUtcFromDate,
    Result: Rows.Event,
    execute: (now) => sql`
      SELECT ${eventColumns(now)}
      FROM events e
      WHERE ${published(sql, "e")}
      ORDER BY ${latestFirst(sql, "e")}`,
  });

  // The lineup in the catalog's order; photos in the order they were
  // attached, the join row's created_at, then id.
  const findPublished = SqlSchema.findOneOption({
    Request: Schema.Struct({
      slug: Schema.String,
      now: Schema.DateTimeUtcFromDate,
    }),
    Result: Rows.EventDetails,
    execute: ({ slug, now }) => sql`
      SELECT ${eventColumns(now)},
        e.luma_guest_count AS "lumaGuestCount",
        e.luma_checked_in_count AS "lumaCheckedInCount",
        ${talksOf(sql, "e", {
          talk: sql`'id', t.id, 'title', t.title,
            'description', t.description, 'format', t.format`,
          speaker: sql`(${sql.literal(profileJson)})::jsonb
            || jsonb_build_object('role', ts.role)`,
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
        ${peopleOf(
          sql,
          "e",
          sql`json_build_object('role', ep.role, 'profile', ${sql.literal(profileJson)})`,
        )} AS people,
        COALESCE((
          SELECT json_agg(json_build_object(
            'url', img.url,
            'alt', img.alt,
            'placeholder', img.placeholder,
            'width', img.width,
            'height', img.height,
            'version', floor(extract(epoch FROM img.updated_at))::bigint::text
          ) ORDER BY ei.created_at, img.id)
          FROM event_images ei
          JOIN images img ON img.id = ei.image_id
          WHERE ei.event_id = e.id
        ), '[]'::json) AS images
      FROM events e
      WHERE ${published(sql, "e")} AND ${resolve(sql, "e", slug)}
      ORDER BY ${linkFirst(sql, "e", slug)}
      LIMIT 1`,
  });

  return Events.of({
    listPublished: orDataSourceError(Effect.flatMap(asOf, listPublished)),
    getPublished: (slug) =>
      orDataSourceError(
        Effect.flatMap(asOf, (now) => findPublished({ slug, now })),
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new EventNotFound({ slug })),
            onSome: Effect.succeed,
          }),
        ),
      ),
  });
});

export class Events extends Context.Service<Events, EventsShape>()(
  "allthings/Events",
) {
  static readonly layer = Layer.effect(Events, make);
}
