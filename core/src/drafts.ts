import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "./errors.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * The drafts the Luma sync stored (private or cancelled Luma events), as
 * the draft preview lists them (web/src/preview/): soonest first. No
 * public route reads this.
 */

export const Draft = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
});
export type Draft = typeof Draft.Type;

export interface DraftsShape {
  readonly list: Effect.Effect<ReadonlyArray<Draft>, DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  return Drafts.of({
    list: sql`
      SELECT slug, name, start_date AS "startDate"
      FROM events WHERE is_draft = true
      ORDER BY start_date, id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Draft))),
      orDataSourceError,
    ),
  });
});

export class Drafts extends Context.Service<Drafts, DraftsShape>()(
  "allthings/Drafts",
) {
  static readonly layer = Layer.effect(Drafts, make);
}
