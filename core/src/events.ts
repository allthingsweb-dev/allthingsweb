import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import {
  hostsOf,
  latestFirst,
  linkFirst,
  peopleOf,
  published,
  resolve,
  talksOf,
} from "./catalog.ts";
import { type DataSourceError, EventNotFound } from "./errors.ts";
import * as Rows from "./rows.ts";
import { imageJson, orDataSourceError, profileJson } from "./sql.ts";

/**
 * Published events. Drafts never leave this service: they are filtered in SQL,
 * and a draft's slug is reported as not found, as the app does today.
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

  const eventColumns = sql.literal(`
    e.id, e.slug, e.name, e.tagline,
    e.start_date AS "startDate", e.end_date AS "endDate",
    e.street_address AS "streetAddress", e.short_location AS "shortLocation",
    e.full_address AS "fullAddress", e.luma_event_id AS "lumaEventId",
    e.recording_url AS "recordingUrl", e.is_hackathon AS "isHackathon",
    ${imageJson("e.preview_image")} AS "previewImage"`);

  const listPublished = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Rows.Event,
    execute: () => sql`
      SELECT ${eventColumns}
      FROM events e
      WHERE ${published(sql, "e")}
      ORDER BY ${latestFirst(sql, "e")}`,
  });

  // The lineup in the catalog's order; photos in the order they were
  // attached, the join row's created_at, then id.
  const findPublished = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Rows.EventDetails,
    execute: (slug) => sql`
      SELECT ${eventColumns},
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
    listPublished: orDataSourceError(listPublished(undefined)),
    getPublished: (slug) =>
      orDataSourceError(findPublished(slug)).pipe(
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
