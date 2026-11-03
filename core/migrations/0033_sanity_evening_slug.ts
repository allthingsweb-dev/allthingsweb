import { statements } from "./statements.ts";

/**
 * React Bay Area at Sanity was on 2024-07-30 (its `start_date` says so),
 * but its long slug was typed as 2014-07-30-react-bay-area-at-sanity. The
 * slug is renamed to the day it was, and the old one becomes a link the
 * evening had before (`event_slugs`, migrations/0013_short_slugs.ts): held
 * by this evening for good, it answers with a permanent redirect to the
 * evening's link, as every link it had does (src/catalog.ts's `resolve`).
 *
 * One statement, so the rename and the old link land together. It matches
 * the wrong slug only, so on any other database, and on a second run, it
 * changes nothing. Data only, with no schema change, so it has no drizzle
 * twin.
 */
export const wrongSlug = "2014-07-30-react-bay-area-at-sanity";
export const rightSlug = "2024-07-30-react-bay-area-at-sanity";

export const sanityEveningSlug: ReadonlyArray<string> = [
  `WITH renamed AS (
    UPDATE "public"."events"
    SET "slug" = '${rightSlug}', "updated_at" = now()
    WHERE "slug" = '${wrongSlug}'
    RETURNING "id"
  )
  INSERT INTO "public"."event_slugs" ("slug", "event_id")
  SELECT '${wrongSlug}', "id" FROM renamed
  ON CONFLICT ("slug") DO NOTHING`,
];

export default statements(sanityEveningSlug);
