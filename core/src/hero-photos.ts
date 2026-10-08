import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import file from "../backfill/hero-photos.json" with { type: "json" };
import { asOf } from "./clock.ts";
import { ended, ours, published } from "./catalog.ts";

/**
 * The photos home's mosaic shows beside the hero, chosen by hand
 * (core/backfill/hero-photos.json): real photos of our evenings that show
 * how big they are, full rooms and packed crowds facing a speaker. Home
 * shows the first of them it can (src/home.ts), in the file's order; the
 * first is the wide tile. Each names the evening it was taken at, which
 * `bun run hero-photos` checks against production (scripts/hero-photos.ts).
 */

const Text = Schema.String.check(
  Schema.isPattern(/^\S(?:[\s\S]*\S)?$/, {
    message: "must say something, without leading or trailing space",
  }),
);

export const HeroPhoto = Schema.Struct({
  /** The `images` row's id. */
  image: Schema.String.check(Schema.isUUID()),
  /** The slug of the evening the photo is attached to. */
  evening: Text,
  /** What the photo shows that earns it the spot. */
  why: Text,
});
export type HeroPhoto = typeof HeroPhoto.Type;

export const HeroPhotosFile = Schema.Struct({
  photos: Schema.Array(HeroPhoto),
});
export type HeroPhotosFile = typeof HeroPhotosFile.Type;

/** Images the file names more than once. */
export function repeated(
  photos: ReadonlyArray<HeroPhoto>,
): ReadonlyArray<string> {
  const images = photos.map((photo) => photo.image);
  return [...new Set(images.filter((image, i) => images.indexOf(image) !== i))];
}

/** The hand-picked photos, in the order home prefers them. */
export const heroPhotos: ReadonlyArray<HeroPhoto> =
  Schema.decodeUnknownSync(HeroPhotosFile)(file).photos;

const Found = Schema.Struct({
  image: Schema.String,
  evening: Schema.String,
  url: Schema.NullOr(Schema.String),
  eveningFound: Schema.Boolean,
  attached: Schema.Boolean,
  published: Schema.Boolean,
  ended: Schema.Boolean,
  ours: Schema.Boolean,
});

/**
 * What keeps each of `photos` from being shown as a hero photo, as of the
 * `Clock`, one line per problem; nothing when home can show them all. A
 * photo must be an image on `photoOrigin` attached to the evening it
 * names, and that evening one of ours, published, and over.
 */
export const heroPhotoProblems = (
  photos: ReadonlyArray<HeroPhoto>,
  photoOrigin: string,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const now = yield* asOf;
    const rows = yield* sql`
      WITH c AS (
        SELECT (p->>'image')::uuid AS image, p->>'evening' AS evening, ord
        FROM json_array_elements(${JSON.stringify(photos)}::json)
          WITH ORDINALITY AS x(p, ord)
      )
      SELECT
        c.image::text AS image, c.evening, img.url,
        e.id IS NOT NULL AS "eveningFound",
        ei.image_id IS NOT NULL AS attached,
        COALESCE(${published(sql, "e")}, false) AS published,
        COALESCE(${ended(sql, "e", now)}, false) AS ended,
        COALESCE(${ours(sql, "e")}, false) AS ours
      FROM c
      LEFT JOIN images img ON img.id = c.image
      LEFT JOIN events e ON e.slug = c.evening
      LEFT JOIN event_images ei ON ei.image_id = c.image AND ei.event_id = e.id
      ORDER BY c.ord`.withoutTransform;
    const found = yield* Schema.decodeUnknownEffect(Schema.Array(Found))(rows);
    return [
      ...repeated(photos).map((image) => `${image} is named more than once`),
      ...found.flatMap((row) => {
        const photo = `${row.image} (${row.evening})`;
        if (row.url === null) return [`${photo}: no such image`];
        if (!row.eveningFound) return [`${photo}: no such evening`];
        return [
          ...(row.attached ? [] : [`${photo}: not a photo of that evening`]),
          ...(row.url.startsWith(`${photoOrigin}/`)
            ? []
            : [`${photo}: not on ${photoOrigin}`]),
          ...(row.published ? [] : [`${photo}: the evening is a draft`]),
          ...(row.ours ? [] : [`${photo}: the evening isn't one of ours`]),
          ...(row.ended ? [] : [`${photo}: the evening hasn't happened yet`]),
        ];
      }),
    ];
  });
