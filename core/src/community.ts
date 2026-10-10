import { Context, type DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { held, type Tally, TallyFields, tally } from "./about.ts";
import {
  latestAppearanceFirst,
  latestFirst,
  talkAppearances,
} from "./catalog.ts";
import { asOf } from "./clock.ts";
import { displayName, eventTopic } from "./lockup.ts";
import { DataSourceError } from "./errors.ts";
import { type FacePick, facePicks } from "./faces.ts";
import { type HeroPick, wallPhotos } from "./hero-photos.ts";
import * as Rows from "./rows.ts";
import { siteSlug } from "./sql.ts";

/**
 * How big allthings is, as the home lab (web/src/pages/lab/) shows it
 * beside home: the about page's tally, a wall of photos from many of our
 * evenings, and the faces of people who have been on stage. Read as of the
 * `Clock`, in one statement, from our published evenings that are over.
 *
 * Every evening held comes with the photo that stands for it, for the
 * lab's contact sheet. The wall is the hand-picked photos (core/backfill/wall-photos.json) the
 * lab can show, in their order, each only as a photo of the evening it
 * names; when it can show none of them, every photo of those evenings,
 * latest evening first. The faces are the hand-picked people
 * (core/backfill/faces.json) the lab can show, in order; when it can show
 * none, everyone who has been on stage with a photo, latest first.
 */

/** The most photos the wall holds. */
export const wallLimit = 48;
/** The most faces the lab shows. */
export const faceLimit = 48;
/** The most evenings the lab reads, latest first: more than we have held. */
export const eveningLimit = 120;

/** A photo on the wall, with the evening it was taken at. */
export interface WallPhoto {
  readonly photo: Rows.Photo;
  /** The evening's slug on this site: its short link, else its long slug. */
  readonly slug: string;
  readonly startsAt: DateTime.Utc;
}

/** Someone who has been on stage, with their photo. */
export interface Face {
  /** Their page's address, /people/<slug>. */
  readonly slug: string;
  readonly name: string;
  readonly photo: Rows.Photo;
}

/**
 * One of our evenings held, with the photo that stands for it: its first
 * on the wall (core/backfill/wall-photos.json), else its first attached,
 * or none when it has no photo here.
 */
export interface HeldEvening {
  /** On this site: its short link, else its long slug. */
  readonly slug: string;
  /** The name as written, without emoji. */
  readonly name: string;
  /** allthings/<topic>, when it has one (see lockup.ts). */
  readonly topic: string | undefined;
  readonly startsAt: DateTime.Utc;
  readonly photo: Rows.Photo | null;
}

export interface CommunityView {
  readonly tally: Tally;
  /** Every evening held, latest first, up to {@link eveningLimit}. */
  readonly evenings: ReadonlyArray<HeldEvening>;
  readonly wall: ReadonlyArray<WallPhoto>;
  readonly faces: ReadonlyArray<Face>;
}

const WallRow = Schema.Struct({
  ...Rows.Photo.fields,
  slug: Schema.String,
  startDate: Schema.DateTimeUtcFromString,
});

const EveningRow = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  startDate: Schema.DateTimeUtcFromString,
  photo: Schema.NullOr(Rows.Photo),
});

const FaceRow = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  photo: Rows.Photo,
});

/** What the lab reads, in one statement. */
export const CommunityRow = Schema.Struct({
  ...TallyFields,
  heldEvenings: Schema.Array(EveningRow),
  wall: Schema.Array(WallRow),
  faces: Schema.Array(FaceRow),
});
export type CommunityRow = typeof CommunityRow.Type;

export function toCommunity(row: CommunityRow): CommunityView {
  return {
    tally: {
      evenings: row.evenings,
      speakers: row.speakers,
      hostingCompanies: row.hostingCompanies,
      guests: row.guests,
    },
    evenings: row.heldEvenings.map((evening) => ({
      slug: evening.slug,
      name: displayName(evening.name),
      topic: eventTopic({ ...evening, curation: { kind: "ours" } }),
      startsAt: evening.startDate,
      photo: evening.photo,
    })),
    wall: row.wall.map(({ slug, startDate, ...photo }) => ({
      photo,
      slug,
      startsAt: startDate,
    })),
    faces: row.faces,
  };
}

export interface CommunityShape {
  /**
   * As of the `Clock`'s now. Photos are taken only from `photoOrigin`
   * (such as "https://media.allthings.dev"), the one origin pages may load
   * images from.
   */
  readonly read: (
    photoOrigin: string,
  ) => Effect.Effect<CommunityView, DataSourceError>;
}

const Request = Schema.Struct({
  now: Schema.DateTimeUtcFromDate,
  photoPrefix: Schema.String,
});

/** An image aliased `img` (or `i`) as a JSON object matching `Rows.Photo`. */
const photoJson = (alias: "img" | "i") =>
  `json_build_object('url', ${alias}.url, 'alt', ${alias}.alt, 'width', ${alias}.width, 'height', ${alias}.height, 'version', floor(extract(epoch FROM ${alias}.updated_at))::bigint::text)`;

/** The lab, with the wall and the faces picked by `wall` and `faces`. */
const make = (
  wall: ReadonlyArray<HeroPick>,
  faces: ReadonlyArray<Pick<FacePick, "profile">>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const wallJson = JSON.stringify(
      wall.map(({ image, evening }) => ({ image, evening })),
    );
    const facesJson = JSON.stringify(faces.map(({ profile }) => ({ profile })));

    const findCommunity = SqlSchema.findOne({
      Request,
      Result: CommunityRow,
      execute: ({ now, photoPrefix }) => {
        const onStage = talkAppearances(sql, {
          whose: "ours",
          when: { ended: now },
        });
        return sql`
      WITH held AS (${held(sql, now)})
      SELECT
        ${tally(sql, now)},
        COALESCE((
          SELECT json_agg(y.picked ORDER BY y.ord)
          FROM (
            SELECT c.ord, ${sql.literal(photoJson("img"))}::jsonb
              || jsonb_build_object('slug', ${sql.literal(siteSlug("e"))}, 'startDate', e.start_date)
              AS picked
            FROM json_array_elements(${wallJson}::json)
              WITH ORDINALITY AS c(pick, ord)
            JOIN images img ON img.id = (c.pick->>'image')::uuid
            JOIN event_images ei ON ei.image_id = img.id
            JOIN held e ON e.id = ei.event_id AND e.slug = c.pick->>'evening'
            WHERE starts_with(img.url, ${photoPrefix})
            ORDER BY c.ord
            LIMIT ${wallLimit}
          ) y
        ), (
          SELECT json_agg(y.picked ORDER BY ${latestFirst(sql, "y")}, y.attached, y.image)
          FROM (
            SELECT
              e.id, e.start_date, ei.created_at AS attached, img.id AS image,
              ${sql.literal(photoJson("img"))}::jsonb
                || jsonb_build_object('slug', ${sql.literal(siteSlug("e"))}, 'startDate', e.start_date)
                AS picked
            FROM held e
            JOIN event_images ei ON ei.event_id = e.id
            JOIN images img ON img.id = ei.image_id
            WHERE starts_with(img.url, ${photoPrefix})
            ORDER BY ${latestFirst(sql, "e")}, ei.created_at, img.id
            LIMIT ${wallLimit}
          ) y
        ), '[]'::json) AS wall,
        COALESCE((
          SELECT json_agg(y.evening ORDER BY ${latestFirst(sql, "y")})
          FROM (
            SELECT e.id, e.start_date, json_build_object(
              'slug', ${sql.literal(siteSlug("e"))}, 'name', e.name,
              'topic', e.topic, 'startDate', e.start_date,
              'photo', (
                SELECT ${sql.literal(photoJson("img"))}
                FROM event_images ei
                JOIN images img ON img.id = ei.image_id
                LEFT JOIN json_array_elements(${wallJson}::json)
                  WITH ORDINALITY AS c(pick, ord)
                  ON (c.pick->>'image')::uuid = img.id
                  AND c.pick->>'evening' = e.slug
                WHERE ei.event_id = e.id AND starts_with(img.url, ${photoPrefix})
                ORDER BY c.ord NULLS LAST, ei.created_at, img.id
                LIMIT 1
              )
            ) AS evening
            FROM held e
            ORDER BY ${latestFirst(sql, "e")}
            LIMIT ${eveningLimit}
          ) y
        ), '[]'::json) AS "heldEvenings",
        COALESCE((
          SELECT json_agg(y.face ORDER BY y.ord)
          FROM (
            SELECT c.ord, json_build_object(
              'slug', p.slug, 'name', p.name, 'photo', ${sql.literal(photoJson("i"))}
            ) AS face
            FROM json_array_elements(${facesJson}::json)
              WITH ORDINALITY AS c(pick, ord)
            JOIN profiles p ON p.id = (c.pick->>'profile')::uuid
            JOIN images i ON i.id = p.image
            WHERE starts_with(i.url, ${photoPrefix})
              AND EXISTS (SELECT 1 FROM ${onStage} a WHERE a.profile_id = p.id)
            ORDER BY c.ord
            LIMIT ${faceLimit}
          ) y
        ), (
          SELECT json_agg(g.face ORDER BY ${latestAppearanceFirst(sql, "g")}, g.profile_id)
          FROM (
            SELECT * FROM (
              SELECT DISTINCT ON (a.profile_id)
                a.profile_id, a.start_date, a.event_id,
                json_build_object(
                  'slug', p.slug, 'name', p.name, 'photo', ${sql.literal(photoJson("i"))}
                ) AS face
              FROM ${onStage} a
              JOIN profiles p ON p.id = a.profile_id
              JOIN images i ON i.id = p.image
              WHERE starts_with(i.url, ${photoPrefix})
              ORDER BY a.profile_id, ${latestAppearanceFirst(sql, "a")}
            ) x
            ORDER BY ${latestAppearanceFirst(sql, "x")}, x.profile_id
            LIMIT ${faceLimit}
          ) g
        ), '[]'::json) AS faces`;
      },
    });

    return Community.of({
      read: (photoOrigin) =>
        Effect.gen(function* () {
          const now = yield* asOf;
          const row = yield* findCommunity({
            now,
            photoPrefix: `${photoOrigin}/`,
          });
          return toCommunity(row);
        }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
    });
  });

export class Community extends Context.Service<Community, CommunityShape>()(
  "allthings/Community",
) {
  /** With the hand-picked wall and faces (core/backfill). */
  static readonly layer = Layer.effect(Community, make(wallPhotos, facePicks));

  /** With the wall and the faces picked by `wall` and `faces`, in order. */
  static readonly layerCurating = (
    wall: ReadonlyArray<HeroPick>,
    faces: ReadonlyArray<Pick<FacePick, "profile">>,
  ) => Layer.effect(Community, make(wall, faces));
}
