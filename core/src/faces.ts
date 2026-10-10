import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import file from "../backfill/faces.json" with { type: "json" };
import { talkAppearances } from "./catalog.ts";
import { asOf } from "./clock.ts";

/**
 * The faces the home lab's "faces" hero is made of, chosen by hand
 * (core/backfill/faces.json): people who have been on stage at our
 * evenings, by their profile, whose profile photo is of them. A logo or a
 * drawing standing in for a person is left out, which no column says, so
 * someone looked. The lab shows them in the file's order
 * (src/community.ts); `bun run hero-photos` checks them against production
 * with the photos (scripts/hero-photos.ts).
 */

const Text = Schema.String.check(
  Schema.isPattern(/^\S(?:[\s\S]*\S)?$/, {
    message: "must say something, without leading or trailing space",
  }),
);

export const FacePick = Schema.Struct({
  /** The `profiles` row's id. */
  profile: Schema.String.check(Schema.isUUID()),
  /** Their name when picked, for reading the file; the profile's is shown. */
  name: Text,
});
export type FacePick = typeof FacePick.Type;

export const FacesFile = Schema.Struct({
  faces: Schema.Array(FacePick),
});
export type FacesFile = typeof FacesFile.Type;

/** The hand-picked faces, in the order the lab shows them. */
export const facePicks: ReadonlyArray<FacePick> =
  Schema.decodeUnknownSync(FacesFile)(file).faces;

/** Profiles the file names more than once. */
export function repeatedFaces(
  faces: ReadonlyArray<Pick<FacePick, "profile">>,
): ReadonlyArray<string> {
  const ids = faces.map((face) => face.profile);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

const Found = Schema.Struct({
  profile: Schema.String,
  name: Schema.String,
  found: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
  onStage: Schema.Boolean,
});

/**
 * What keeps each of `faces` from being shown, as of the `Clock`, one line
 * per problem; nothing when the lab can show them all. A face is a profile
 * with a photo on `photoOrigin` who has been on stage at one of our
 * published evenings that is over.
 */
export const faceProblems = (
  faces: ReadonlyArray<Pick<FacePick, "profile" | "name">>,
  photoOrigin: string,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const now = yield* asOf;
    const rows = yield* sql`
      WITH c AS (
        SELECT (f->>'profile')::uuid AS profile, f->>'name' AS name, ord
        FROM json_array_elements(${JSON.stringify(
          faces.map(({ profile, name }) => ({ profile, name })),
        )}::json)
          WITH ORDINALITY AS x(f, ord)
      )
      SELECT
        c.profile::text AS profile, c.name,
        p.id IS NOT NULL AS found,
        i.url,
        EXISTS (
          SELECT 1
          FROM ${talkAppearances(sql, { whose: "ours", when: { ended: now } })} a
          WHERE a.profile_id = c.profile
        ) AS "onStage"
      FROM c
      LEFT JOIN profiles p ON p.id = c.profile
      LEFT JOIN images i ON i.id = p.image
      ORDER BY c.ord`.withoutTransform;
    const found = yield* Schema.decodeUnknownEffect(Schema.Array(Found))(rows);
    return [
      ...repeatedFaces(faces).map((id) => `${id} is named more than once`),
      ...found.flatMap((row) => {
        const face = `${row.profile} (${row.name})`;
        if (!row.found) return [`${face}: no such profile`];
        return [
          ...(row.url === null
            ? [`${face}: no photo`]
            : row.url.startsWith(`${photoOrigin}/`)
              ? []
              : [`${face}: the photo isn't on ${photoOrigin}`]),
          ...(row.onStage
            ? []
            : [`${face}: hasn't been on stage at one of our evenings`]),
        ];
      }),
    ];
  });
