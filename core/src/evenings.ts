import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { pageNow } from "./clock.ts";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import {
  ahead,
  ended,
  latestFirst,
  published,
  soonestFirst,
} from "./catalog.ts";
import { DataSourceError } from "./errors.ts";
import { type Evening, toEvening } from "./home.ts";
import * as Rows from "./rows.ts";
import { listingJson } from "./sql.ts";

/**
 * Every evening, as the evenings index lists them, read as of the `Clock`:
 * those still ahead first, then all that have ended. Drafts never become
 * one. Each is the same {@link Evening} home lists, so a row reads the same
 * on both pages.
 */

export interface EveningsView {
  /** Every evening that hasn't ended (live or upcoming), soonest first. */
  readonly ahead: ReadonlyArray<Evening>;
  /** Every evening that has ended, latest first. */
  readonly past: ReadonlyArray<Evening>;
}

export const EveningsRow = Schema.Struct({
  ahead: Schema.Array(Rows.Listing),
  past: Schema.Array(Rows.Listing),
});

export type EveningsRow = typeof EveningsRow.Type;

export function toEvenings(row: EveningsRow, now: DateTime.Utc): EveningsView {
  return {
    ahead: row.ahead.map((listing) => toEvening(listing, now)),
    past: row.past.map((listing) => toEvening(listing, now)),
  };
}

export interface EveningsShape {
  /** Every published evening as of the `Clock`'s now. */
  readonly read: Effect.Effect<EveningsView, DataSourceError>;
}

const Request = Schema.Struct({ now: Schema.DateTimeUtcFromDate });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const listing = sql.literal(listingJson);

  // As on home: ahead soonest first, over latest first.
  const findEvenings = SqlSchema.findOne({
    Request,
    Result: EveningsRow,
    execute: ({ now }) => sql`
      SELECT
        COALESCE((
          SELECT json_agg(${listing} ORDER BY ${soonestFirst(sql, "e")})
          FROM events e
          WHERE ${published(sql, "e")} AND ${ahead(sql, "e", now)}
        ), '[]'::json) AS ahead,
        COALESCE((
          SELECT json_agg(${listing} ORDER BY ${latestFirst(sql, "e")})
          FROM events e
          WHERE ${published(sql, "e")} AND ${ended(sql, "e", now)}
        ), '[]'::json) AS past`,
  });

  return Evenings.of({
    read: Effect.gen(function* () {
      const now = yield* pageNow;
      return toEvenings(yield* findEvenings({ now }), now);
    }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  });
});

export class Evenings extends Context.Service<Evenings, EveningsShape>()(
  "allthings/Evenings",
) {
  static readonly layer = Layer.effect(Evenings, make);
}
