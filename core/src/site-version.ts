import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { published, statusChanges } from "./catalog.ts";
import type { DataSourceError } from "./errors.ts";
import { siteTables } from "./site-tables.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * Which version of the public data the site shows, so a page built from it
 * can be kept until it changes (web/src/page-store.ts).
 *
 * - `version` is a digest of every row of every table the public site
 *   reads ({@link siteTables}, all site_reader may read): any write to any
 *   of them, by the sync, the studio, a migration or by hand, changes it,
 *   and nothing else does. Nothing has to remember to bump it.
 * - `boundaries` are the instants at which a page may change with no
 *   write, as pages read the clock (the start of each minute, clock.ts):
 *   each published evening's start, when it goes live, and the first minute
 *   after the one it ends in, when it is over (catalog.ts's `ahead`,
 *   `ended` and `eventStatus` are the only rules that read the clock).
 *
 * One statement, with `now()` in it so Hyperdrive never answers it from its
 * cache (Hyperdrive caches no statement that calls a volatile function).
 * About 20 ms in production (2026-11-01).
 */

export { siteTables };

/** The public data's version, and when pages may change without it. */
export interface SiteState {
  /** A digest of every row the site reads (hex). */
  readonly version: string;
  /** Epoch milliseconds, ascending, without repeats. */
  readonly boundaries: ReadonlyArray<number>;
}

export interface SiteVersionShape {
  readonly read: Effect.Effect<SiteState, DataSourceError>;
}

const Row = Schema.Struct({
  version: Schema.String,
  boundaries: Schema.Array(Schema.Number),
});

/**
 * One table's rows, digested in an order of their own (each row's digest),
 * so the digest depends only on what the table holds.
 */
const tableDigest = (table: (typeof siteTables)[number]) =>
  `(SELECT md5(COALESCE(string_agg(md5(t::text), '' ORDER BY md5(t::text)), '')) FROM public.${table} t)`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const digest = sql.literal(siteTables.map(tableDigest).join(" || "));

  const read: Effect.Effect<SiteState, DataSourceError> = sql`
    SELECT md5(${digest}) AS version,
      COALESCE((
        SELECT json_agg(b.at ORDER BY b.at)
        FROM (
          SELECT DISTINCT floor(extract(epoch FROM x.at) * 1000)::bigint AS at
          FROM events e
          CROSS JOIN LATERAL ${statusChanges(sql, "e")} AS x(at)
          WHERE ${published(sql, "e")} AND x.at IS NOT NULL
        ) b
      ), '[]'::json) AS boundaries,
      now() AS read_at`.pipe(
    Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Row)(row)),
    orDataSourceError,
    Effect.withSpan("SiteVersion.read"),
  );

  return SiteVersion.of({ read });
});

export class SiteVersion extends Context.Service<
  SiteVersion,
  SiteVersionShape
>()("allthings/SiteVersion") {
  /** Needs a `SqlClient`. */
  static readonly layer = Layer.effect(SiteVersion, make);
}
