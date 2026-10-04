import { Effect, type Schema } from "effect";
import type { SqlError } from "effect/sql/SqlError";
import { DataSourceError } from "./errors.ts";

/**
 * SQL snippets shared by the repositories. Related rows are nested as JSON so
 * that each repository call is a single statement: from a Worker, every extra
 * round trip to the database costs more than the query itself.
 *
 * Arguments are always constants written in this package, never input; the
 * snippets reach a query through `sql.literal`.
 */

/** The image `column` references, as a JSON object matching `rows.Image`, or NULL. */
export const imageJson = (column: string): string =>
  `(SELECT json_build_object('url', i.url, 'alt', i.alt, 'placeholder', i.placeholder, 'width', i.width, 'height', i.height) FROM images i WHERE i.id = ${column})`;

/** The profile aliased `alias`, as a JSON object matching `rows.Profile`. */
export const profileJson = (alias: string): string =>
  `json_build_object('id', ${alias}.id, 'name', ${alias}.name, 'title', ${alias}.title, 'bio', ${alias}.bio, 'twitterHandle', ${alias}.twitter_handle, 'blueskyHandle', ${alias}.bluesky_handle, 'linkedinHandle', ${alias}.linkedin_handle, 'image', ${imageJson(`${alias}.image`)})`;

/** Folds SQL and decoding failures into the one error callers handle. */
export const orDataSourceError = <A, R>(
  effect: Effect.Effect<A, SqlError | Schema.SchemaError, R>,
): Effect.Effect<A, DataSourceError, R> =>
  Effect.mapError(effect, (cause) => new DataSourceError({ cause }));
