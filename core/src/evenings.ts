import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { pageNow } from "./clock.ts";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
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

  // As on home: an evening is ahead through its end (eventStatus), and ids
  // break ties between equal starts, so the order never depends on the
  // planner.
  const findEvenings = SqlSchema.findOne({
    Request,
    Result: EveningsRow,
    execute: ({ now }) => sql`
      SELECT
        COALESCE((
          SELECT json_agg(${listing} ORDER BY e.start_date, e.id)
          FROM events e
          WHERE e.is_draft = false AND e.end_date >= ${now}
        ), '[]'::json) AS ahead,
        COALESCE((
          SELECT json_agg(${listing} ORDER BY e.start_date DESC, e.id)
          FROM events e
          WHERE e.is_draft = false AND e.end_date < ${now}
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
