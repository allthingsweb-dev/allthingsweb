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
import { displayName, eventTopic } from "./lockup.ts";
import { eventStatus } from "./catalog.ts";
import { rsvpUrl } from "./mappers.ts";
import { neighborhoodOf } from "./places.ts";
import * as Rows from "./rows.ts";
import { listingJson } from "./sql.ts";

/**
 * What the home page shows, read as of the `Clock`. Home says each thing
 * once (brand/foundations.md, "Layout"): our next evening is the hero, and
 * the lists below show only other evenings, ours and the ones we share,
 * marked as such. The photos beside the hero are the community's wall
 * (src/community.ts), which the page reads with it.
 */

/** "After that" lists at most this many evenings after the next one. */
export const afterThatLimit = 3;
/** "Recently" lists this many evenings that have ended. */
export const recentlyLimit = 3;

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
  };
}

export interface HomeShape {
  /** Home as of the `Clock`'s now. */
  readonly read: Effect.Effect<HomeView, DataSourceError>;
}

const Request = Schema.Struct({ now: Schema.DateTimeUtcFromDate });

/** Home, read in one statement. */
const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // "Next" is the soonest of ours not yet over; "ahead" holds enough to
  // list the rest after it.
  const findHome = SqlSchema.findOne({
    Request,
    Result: Rows.HomeRow,
    execute: ({ now }) => {
      const listing = listingJson(sql, now);
      return sql`
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
        ), '[]'::json) AS recent`;
    },
  });

  return Home.of({
    read: Effect.gen(function* () {
      const now = yield* asOf;
      const row = yield* findHome({ now });
      return toHome(row, now);
    }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  });
});

export class Home extends Context.Service<Home, HomeShape>()("allthings/Home") {
  static readonly layer = Layer.effect(Home, make);
}
