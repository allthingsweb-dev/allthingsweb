import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type { DataSourceError } from "./errors.ts";
import * as Rows from "./rows.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * People's photos from their profiles, looked up by profile id: ids are
 * stable where names are not, so whoever is shown is chosen in config, not
 * matched by name at runtime.
 */

/** A profile's photo, keyed by the profile's id. */
export type PortraitsById = ReadonlyMap<string, Rows.Photo>;

export interface PortraitsShape {
  /**
   * The photos of the profiles with these ids. A profile that doesn't
   * exist, has no photo, or whose photo is not on `photoOrigin` (such as
   * "https://media.allthings.dev", the one origin pages may load images
   * from) has no entry: the page shows the brand's blank avatar instead.
   */
  readonly read: (
    profileIds: ReadonlyArray<string>,
    photoOrigin: string,
  ) => Effect.Effect<PortraitsById, DataSourceError>;
}

const Request = Schema.Struct({
  profileIds: Schema.NonEmptyArray(Schema.String),
  photoPrefix: Schema.String,
});

/** The repository over the request's `SqlClient`. */
const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  const findPortraits = SqlSchema.findAll({
    Request,
    Result: Rows.Portrait,
    execute: ({ profileIds, photoPrefix }) => sql`
      SELECT p.id AS "profileId", i.url, i.alt, i.width, i.height
      FROM profiles p
      JOIN images i ON i.id = p.image
      WHERE p.id IN ${sql.in(profileIds)}
        AND starts_with(i.url, ${photoPrefix})`,
  });

  return Portraits.of({
    read: (profileIds, photoOrigin) => {
      const [first, ...rest] = profileIds;
      if (first === undefined) return Effect.succeed(new Map());
      return orDataSourceError(
        findPortraits({
          profileIds: [first, ...rest],
          photoPrefix: `${photoOrigin}/`,
        }),
      ).pipe(
        Effect.map(
          (rows): PortraitsById =>
            new Map(
              rows.map(
                ({ profileId, ...photo }) => [profileId, photo] as const,
              ),
            ),
        ),
      );
    },
  });
});

export class Portraits extends Context.Service<Portraits, PortraitsShape>()(
  "allthings/Portraits",
) {
  static readonly layer = Layer.effect(Portraits, make);
}
