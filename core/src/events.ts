import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
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
   * people (organizers, co-hosts, MC) and its photos, by its long slug or
   * its short link.
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

  // The id breaks ties between events that start together, which the app
  // leaves to the planner.
  const listPublished = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Rows.Event,
    execute: () => sql`
      SELECT ${eventColumns}
      FROM events e
      WHERE e.is_draft = false
      ORDER BY e.start_date DESC, e.id`,
  });

  // Talks, speakers, hosts and photos are listed in the order they were
  // attached: the join row's created_at, then id. The app reads them without
  // ORDER BY, which leaves their order to the query planner. People come by
  // role (organizers, co-hosts, the MC), then their position in it.
  const findPublished = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Rows.EventDetails,
    execute: (slug) => sql`
      SELECT ${eventColumns},
        e.luma_guest_count AS "lumaGuestCount",
        e.luma_checked_in_count AS "lumaCheckedInCount",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', t.id,
            'title', t.title,
            'description', t.description,
            'format', t.format,
            'speakers', COALESCE((
              SELECT json_agg(
                (${sql.literal(profileJson)})::jsonb || jsonb_build_object('role', ts.role)
                ORDER BY ts.created_at, p.id)
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
            'id', s.id,
            'name', s.name,
            'about', s.about,
            'squareLogoLight', ${sql.literal(imageJson("s.square_logo_light"))},
            'squareLogoDark', ${sql.literal(imageJson("s.square_logo_dark"))}
          ) ORDER BY es.created_at, s.id)
          FROM event_sponsors es
          JOIN sponsors s ON s.id = es.sponsor_id
          WHERE es.event_id = e.id
        ), '[]'::json) AS hosts,
        COALESCE((
          SELECT json_agg(json_build_object(
            'role', ep.role,
            'profile', ${sql.literal(profileJson)}
          ) ORDER BY array_position(ARRAY['organizer', 'co-host', 'mc'], ep.role),
            ep.position, ep.created_at, p.id)
          FROM event_people ep
          JOIN profiles p ON p.id = ep.profile_id
          WHERE ep.event_id = e.id
        ), '[]'::json) AS people,
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
      WHERE e.is_draft = false
        AND (e.slug = ${slug} OR e.short_slug = ${slug})`,
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
