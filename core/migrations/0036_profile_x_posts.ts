import { statements } from "./statements.ts";

/**
 * A person's standout recent posts on X (src/x-posts.ts, core's README,
 * "Their posts on X"): `profiles.x_posts`, one dated record as JSON, or
 * null. Only the people backfill writes it (src/people-enrichment.ts), from
 * core/backfill/people.json, and the record's shape is decoded there and
 * wherever it is read; the column only insists on an object. Ships with
 * the app's drizzle migration 0045_profile_x_posts, which makes the same
 * schema.
 *
 * profile_editor, the role that applies the file
 * (migrations/0034_profile_editor.ts), may read and write the new column,
 * and nothing else more: src/profile-editor.ts lists it with the rest.
 */
export const profileXPosts: ReadonlyArray<string> = [
  `ALTER TABLE "public"."profiles" ADD COLUMN "x_posts" jsonb`,
  `ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_x_posts_check" CHECK (jsonb_typeof("x_posts") = 'object')`,
  `GRANT SELECT ("x_posts"), UPDATE ("x_posts") ON "public"."profiles" TO profile_editor`,
];

export default statements(profileXPosts);
