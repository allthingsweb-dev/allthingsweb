import { Effect, type Schema } from "effect";
import type { SqlError } from "effect/sql/SqlError";
import { DataSourceError } from "./errors.ts";

/**
 * SQL snippets shared by the repositories. Related rows are nested as JSON so
 * that each repository call is a single statement: from a Worker, every extra
 * round trip to the database costs more than the query itself.
 *
 * The snippets reach a query through `sql.literal`, so their arguments are
 * typed as the few constant column names the repositories use: no input can
 * reach them.
 */

/** Columns that reference an image, as the repositories alias their tables. */
export type ImageColumn =
  | "e.preview_image"
  | "p.image"
  | "s.square_logo_light"
  | "s.square_logo_dark";

/** The image `column` references, as a JSON object matching `rows.Image`, or NULL. */
export const imageJson = (column: ImageColumn): string =>
  `(SELECT json_build_object('url', i.url, 'alt', i.alt, 'placeholder', i.placeholder, 'width', i.width, 'height', i.height) FROM images i WHERE i.id = ${column})`;

/** The profile aliased `p`, as a JSON object matching `rows.Profile`. */
export const profileJson: string = `json_build_object('id', p.id, 'name', p.name, 'title', p.title, 'bio', p.bio, 'twitterHandle', p.twitter_handle, 'blueskyHandle', p.bluesky_handle, 'linkedinHandle', p.linkedin_handle, 'image', ${imageJson("p.image")})`;

/** Folds SQL and decoding failures into the one error callers handle. */
export const orDataSourceError = <A, R>(
  effect: Effect.Effect<A, SqlError | Schema.SchemaError, R>,
): Effect.Effect<A, DataSourceError, R> =>
  Effect.mapError(effect, (cause) => new DataSourceError({ cause }));
