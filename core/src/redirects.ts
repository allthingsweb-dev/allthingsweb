import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { type DataSourceError, RedirectNotFound } from "./errors.ts";
import * as Rows from "./rows.ts";
import { orDataSourceError } from "./sql.ts";

/** Short links: `/r/<slug>` redirects to a stored destination. */
export interface RedirectsShape {
  /** The redirect stored under exactly this slug; matching is case-sensitive. */
  readonly lookup: (
    slug: string,
  ) => Effect.Effect<Rows.Redirect, RedirectNotFound | DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Rows.Redirect,
    execute: (slug) => sql`
      SELECT slug, destination_url AS "destinationUrl"
      FROM redirects
      WHERE slug = ${slug}`,
  });

  return Redirects.of({
    lookup: (slug) =>
      orDataSourceError(find(slug)).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new RedirectNotFound({ slug })),
            onSome: Effect.succeed,
          }),
        ),
      ),
  });
});

export class Redirects extends Context.Service<Redirects, RedirectsShape>()(
  "allthings/Redirects",
) {
  static readonly layer = Layer.effect(Redirects, make);
}
