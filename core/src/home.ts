import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { asOf } from "./clock.ts";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Contract from "./contract.ts";
import {
  ahead,
  ended,
  latestFirst,
  ours,
  published,
  soonestFirst,
} from "./catalog.ts";
import { DataSourceError } from "./errors.ts";
import { heroPhotos } from "./hero-photos.ts";
import { displayName, eventTopic } from "./lockup.ts";
import { eventStatus } from "./catalog.ts";
import { rsvpUrl } from "./mappers.ts";
import { neighborhoodOf } from "./places.ts";
import * as Rows from "./rows.ts";
import { listingJson } from "./sql.ts";

/**
 * What the home page shows, read as of the `Clock`. Home says each thing
 * once (brand/foundations.md, "Layout"): our next evening is the hero, real
 * photos of ours sit beside it, and the lists below show only other
 * evenings, ours and the ones we share, marked as such.
 */

/** "After that" lists at most this many evenings after the next one. */
export const afterThatLimit = 3;
/** "Recently" lists this many evenings that have ended. */
export const recentlyLimit = 3;
/** The photo mosaic's tiles. */
export const photoLimit = 3;

/** An evening as home shows it. Drafts never become one. */
export interface Evening {
  readonly slug: string;
  /** The name as written, without emoji. */
  readonly name: string;
  /** allthings/<topic>: the one the site set, else the name's, if any (see lockup.ts). */
  readonly topic: string | undefined;
  /** At the `Clock`'s now. */
  readonly status: Contract.EventStatus;
  readonly startsAt: DateTime.Utc;
  /** The local name of the venue's neighborhood, when the venue is known. */
  readonly neighborhood: string | null;
  /** The hosting companies' names, in the order they were attached. */
  readonly hosts: ReadonlyArray<string>;
  /** Where "I'm in" goes: the event's Luma page. */
  readonly rsvpUrl: string | null;
  /** Ours, or someone else's evening we share, with who organizes it. */
  readonly curation: Rows.Curation;
}

export interface HomeView {
  /**
   * Our live or next evening, if one is announced: the hero is always one
   * of ours, never one we only share.
   */
  readonly next: Evening | undefined;
  /** The other evenings announced, ours and shared, soonest first. */
  readonly afterThat: ReadonlyArray<Evening>;
  /** The latest evenings that have ended, latest first. */
  readonly recently: ReadonlyArray<Evening>;
  /**
   * The hand-picked hero photos (src/hero-photos.ts) home can show, in
   * their order. When it can show none of them, the first photo attached to
   * each of the latest evenings with photos, latest first: one per evening,
   * so the mosaic shows different nights.
   */
  readonly photos: ReadonlyArray<Rows.Photo>;
}

export function toEvening(listing: Rows.Listing, now: DateTime.Utc): Evening {
  return {
    slug: listing.slug,
    name: displayName(listing.name),
    topic: eventTopic(listing),
    status: eventStatus(listing, now),
    startsAt: listing.startDate,
    neighborhood: neighborhoodOf([
      listing.streetAddress,
      listing.fullAddress,
      listing.shortLocation,
    ]),
    hosts: listing.hosts,
    rsvpUrl: rsvpUrl(listing.lumaEventId),
    curation: listing.curation,
  };
}

export function toHome(row: Rows.HomeRow, now: DateTime.Utc): HomeView {
  const next = row.next === null ? undefined : toEvening(row.next, now);
  return {
    next,
    afterThat: row.ahead
      .filter((listing) => listing.slug !== next?.slug)
      .slice(0, afterThatLimit)
      .map((listing) => toEvening(listing, now)),
    recently: row.recent.map((listing) => toEvening(listing, now)),
    photos: row.photos,
  };
}

export interface HomeShape {
  /**
   * Home as of the `Clock`'s now. Photos are taken only from
   * `photoOrigin` (such as "https://media.allthings.dev"), the one origin
   * pages may load images from.
   */
  readonly read: (
    photoOrigin: string,
  ) => Effect.Effect<HomeView, DataSourceError>;
}

const Request = Schema.Struct({
  now: Schema.DateTimeUtcFromDate,
  photoPrefix: Schema.String,
});

/** Home, its mosaic preferring the images `curated` names, in that order. */
const make = (curated: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const listing = sql.literal(listingJson);

    // "Next" is the soonest of ours not yet over; "ahead" holds enough to
    // list the rest after it. Photos are of ours that are over: the curated
    // ones in their order, or, when none of those can be shown, the first
    // attached of each, latest evening first.
    const curatedJson = JSON.stringify(curated);
    const findHome = SqlSchema.findOne({
      Request,
      Result: Rows.HomeRow,
      execute: ({ now, photoPrefix }) => sql`
      SELECT
        (
          SELECT ${listing}
          FROM events e
          WHERE ${published(sql, "e")} AND ${ahead(sql, "e", now)}
            AND ${ours(sql, "e")}
          ORDER BY ${soonestFirst(sql, "e")}
          LIMIT 1
        ) AS next,
        COALESCE((
          SELECT json_agg(x.listing ORDER BY ${soonestFirst(sql, "x")})
          FROM (
            SELECT ${listing} AS listing, e.start_date, e.id
            FROM events e
            WHERE ${published(sql, "e")} AND ${ahead(sql, "e", now)}
            ORDER BY ${soonestFirst(sql, "e")}
            LIMIT ${1 + afterThatLimit}
          ) x
        ), '[]'::json) AS ahead,
        COALESCE((
          SELECT json_agg(x.listing ORDER BY ${latestFirst(sql, "x")})
          FROM (
            SELECT ${listing} AS listing, e.start_date, e.id
            FROM events e
            WHERE ${published(sql, "e")} AND ${ended(sql, "e", now)}
            ORDER BY ${latestFirst(sql, "e")}
            LIMIT ${recentlyLimit}
          ) x
        ), '[]'::json) AS recent,
        COALESCE((
          SELECT json_agg(json_build_object(
            'url', y.url, 'alt', y.alt, 'width', y.width, 'height', y.height,
            'version', y.version
          ) ORDER BY y.ord)
          FROM (
            SELECT
              c.ord, img.url, img.alt, img.width, img.height,
              floor(extract(epoch FROM img.updated_at))::bigint::text AS version
            FROM json_array_elements_text(${curatedJson}::json)
              WITH ORDINALITY AS c(id, ord)
            JOIN images img ON img.id = c.id::uuid
            WHERE starts_with(img.url, ${photoPrefix})
              AND EXISTS (
                SELECT 1
                FROM event_images ei
                JOIN events e ON e.id = ei.event_id
                WHERE ei.image_id = img.id
                  AND ${published(sql, "e")} AND ${ended(sql, "e", now)}
                  AND ${ours(sql, "e")}
              )
            ORDER BY c.ord
            LIMIT ${photoLimit}
          ) y
        ), (
          SELECT json_agg(json_build_object(
            'url', y.url, 'alt', y.alt, 'width', y.width, 'height', y.height,
            'version', y.version
          ) ORDER BY ${latestFirst(sql, "y")})
          FROM (
            SELECT * FROM (
              SELECT DISTINCT ON (e.id)
                e.id, e.start_date,
                img.url, img.alt, img.width, img.height,
                floor(extract(epoch FROM img.updated_at))::bigint::text AS version
              FROM events e
              JOIN event_images ei ON ei.event_id = e.id
              JOIN images img ON img.id = ei.image_id
              WHERE ${published(sql, "e")} AND ${ended(sql, "e", now)}
                AND ${ours(sql, "e")}
                AND starts_with(img.url, ${photoPrefix})
              ORDER BY e.id, ei.created_at, img.id
            ) x
            ORDER BY ${latestFirst(sql, "x")}
            LIMIT ${photoLimit}
          ) y
        ), '[]'::json) AS photos`,
    });

    return Home.of({
      read: (photoOrigin) =>
        Effect.gen(function* () {
          const now = yield* asOf;
          const row = yield* findHome({ now, photoPrefix: `${photoOrigin}/` });
          return toHome(row, now);
        }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
    });
  });

export class Home extends Context.Service<Home, HomeShape>()("allthings/Home") {
  /** Home with the hand-picked hero photos (core/backfill/hero-photos.json). */
  static readonly layer = Layer.effect(
    Home,
    make(heroPhotos.map((photo) => photo.image)),
  );

  /** Home with the mosaic preferring `curated`, image ids in order. */
  static readonly layerCurating = (curated: ReadonlyArray<string>) =>
    Layer.effect(Home, make(curated));
}
