import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { pageNow } from "./clock.ts";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type * as Contract from "./contract.ts";
import { DataSourceError } from "./errors.ts";
import { displayName, eventTopic } from "./lockup.ts";
import { eventStatus, rsvpUrl } from "./mappers.ts";
import { neighborhoodOf } from "./places.ts";
import * as Rows from "./rows.ts";
import { listingJson } from "./sql.ts";

/**
 * What the home page shows, read as of the `Clock`. Home says each thing
 * once (brand/foundations.md, "Layout"): the next evening is the hero, real
 * photos sit beside it, and the lists below show only other evenings.
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
  /** all things/<topic>: the one the site set, else the name's, if any (see lockup.ts). */
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
}

export interface HomeView {
  /** The live or next evening, if one is announced. */
  readonly next: Evening | undefined;
  /** The evenings announced after it, soonest first. */
  readonly afterThat: ReadonlyArray<Evening>;
  /** The latest evenings that have ended, latest first. */
  readonly recently: ReadonlyArray<Evening>;
  /**
   * The first photo attached to each of the latest evenings with photos,
   * latest first: one per evening, so the mosaic shows different nights.
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
  };
}

export function toHome(row: Rows.HomeRow, now: DateTime.Utc): HomeView {
  const [next, ...afterThat] = row.ahead.map((listing) =>
    toEvening(listing, now),
  );
  return {
    next,
    afterThat,
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

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  const listing = sql.literal(listingJson);

  // An event is live through its end, so "ahead" is everything that hasn't
  // ended (as eventStatus has it). Ids break ties between equal starts.
  const findHome = SqlSchema.findOne({
    Request,
    Result: Rows.HomeRow,
    execute: ({ now, photoPrefix }) => sql`
      SELECT
        COALESCE((
          SELECT json_agg(x.listing ORDER BY x.start_date, x.id)
          FROM (
            SELECT ${listing} AS listing, e.start_date, e.id
            FROM events e
            WHERE e.is_draft = false AND e.end_date >= ${now}
            ORDER BY e.start_date, e.id
            LIMIT ${1 + afterThatLimit}
          ) x
        ), '[]'::json) AS ahead,
        COALESCE((
          SELECT json_agg(x.listing ORDER BY x.start_date DESC, x.id)
          FROM (
            SELECT ${listing} AS listing, e.start_date, e.id
            FROM events e
            WHERE e.is_draft = false AND e.end_date < ${now}
            ORDER BY e.start_date DESC, e.id
            LIMIT ${recentlyLimit}
          ) x
        ), '[]'::json) AS recent,
        COALESCE((
          SELECT json_agg(json_build_object(
            'url', p.url, 'alt', p.alt, 'width', p.width, 'height', p.height,
            'version', p.version
          ) ORDER BY p.start_date DESC, p.event_id)
          FROM (
            SELECT * FROM (
              SELECT DISTINCT ON (e.id)
                e.id AS event_id, e.start_date,
                img.url, img.alt, img.width, img.height,
                floor(extract(epoch FROM img.updated_at))::bigint::text AS version
              FROM events e
              JOIN event_images ei ON ei.event_id = e.id
              JOIN images img ON img.id = ei.image_id
              WHERE e.is_draft = false AND e.end_date < ${now}
                AND starts_with(img.url, ${photoPrefix})
              ORDER BY e.id, ei.created_at, img.id
            ) first_photos
            ORDER BY start_date DESC, event_id
            LIMIT ${photoLimit}
          ) p
        ), '[]'::json) AS photos`,
  });

  return Home.of({
    read: (photoOrigin) =>
      Effect.gen(function* () {
        const now = yield* pageNow;
        const row = yield* findHome({ now, photoPrefix: `${photoOrigin}/` });
        return toHome(row, now);
      }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  });
});

export class Home extends Context.Service<Home, HomeShape>()("allthings/Home") {
  static readonly layer = Layer.effect(Home, make);
}
