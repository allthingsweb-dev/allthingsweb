/**
 * profile_editor, the role `bun run people <file>` connects as (core's
 * README, "Filling in profiles"): its name, the `public.profiles` columns
 * src/people-enrichment.ts reads and writes, and the bounds on its
 * sessions. migrations/0034_profile_editor.ts granted exactly these, and
 * infra/scripts/profile-editor.ts refuses to give the role a login unless
 * the catalog holds exactly these. It imports nothing, so the infra
 * scripts read it without core's dependencies.
 *
 * Migration 0034 states its own copy, fixed as it ran, and no migration
 * reads this module: a change to the role is a new migration that grants
 * (or revokes) the difference, with this list changed in the same pull
 * request, so the script and tests/profile-editor-role.test.ts (which
 * states the list once more, and reads the catalog after every migration)
 * agree with it.
 */

export const PROFILE_EDITOR = "profile_editor";

/** What applyPeople reads of `public.profiles`. */
export const PROFILE_EDITOR_READS = [
  "id",
  "name",
  "title",
  "bio",
  "twitter_handle",
  "bluesky_handle",
  "linkedin_handle",
  "photo_source_url",
  "image",
  "now_record",
] as const;

/** What applyPeople writes of `public.profiles`. */
export const PROFILE_EDITOR_WRITES = [
  "title",
  "bio",
  "twitter_handle",
  "bluesky_handle",
  "linkedin_handle",
  "photo_source_url",
  "now_record",
  "updated_at",
] as const;

/** Bounds on every session, as the studio's (infra/scripts/studio.ts). */
export const PROFILE_EDITOR_SETTINGS = {
  statement_timeout: "30s",
  lock_timeout: "5s",
  idle_in_transaction_session_timeout: "30s",
} as const;
