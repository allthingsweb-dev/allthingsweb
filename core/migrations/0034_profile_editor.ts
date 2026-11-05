import { statements } from "./statements.ts";

/**
 * `profile_editor`: the role `bun run people <file>` connects as (core's
 * README, "Filling in profiles"), so filling titles, bios, handles, photo
 * sources and "now" records from a reviewed file no longer needs the
 * database owner. It may do exactly what src/people-enrichment.ts's
 * statements do, and nothing else:
 *
 * - read, on `public.profiles` only, the columns applyPeople reads
 *   (READS): the row it locks (`FOR UPDATE`, which Postgres
 *   allows a role with UPDATE on any column), its name, and each value
 *   it compares or keeps (`COALESCE(…, title)`);
 * - change only the columns it writes (WRITES). The
 *   `profiles_x_followers_reset` trigger clears the X counts a new handle
 *   makes stale as part of the same UPDATE, which needs no grant of its
 *   own: privileges are checked on what the statement names.
 * - no INSERT or DELETE anywhere, no other table, no sequence, no
 *   function but those PUBLIC may run, no DDL, no ownership, no
 *   BYPASSRLS. Its statements, lock waits and idle transactions time out
 *   as the studio's do.
 *
 * The role is made here without a login. Its login and password are set
 * by infra/scripts/profile-editor.ts, run as the owner once this has run,
 * which stores the connection string in 1Password ("allthings
 * profile_editor") and never prints it. Where the role exists already (a
 * Postgres server whose other database made it), it keeps its attributes
 * and loses every other privilege here, so it holds exactly these.
 *
 * Grants and roles aren't schema (src/schema-snapshot.ts leaves them
 * out), so it has no drizzle twin and no line in production-schema.txt.
 * tests/profile-editor-role.test.ts holds the catalog to these lists,
 * tries every column of `public` and `planning` both ways, and runs
 * applyPeople as the role.
 */

/*
 * Fixed here, as this migration ran: src/profile-editor.ts is the role as
 * it stands now (what infra/scripts/profile-editor.ts and the tests check),
 * and a later change to it ships as a migration of its own that grants the
 * difference, so this one keeps granting exactly this on a fresh database.
 */
const PROFILE_EDITOR = "profile_editor";

const READS = [
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
];

const WRITES = [
  "title",
  "bio",
  "twitter_handle",
  "bluesky_handle",
  "linkedin_handle",
  "photo_source_url",
  "now_record",
  "updated_at",
];

const SETTINGS = {
  statement_timeout: "30s",
  lock_timeout: "5s",
  idle_in_transaction_session_timeout: "30s",
};

const columns = (names: ReadonlyArray<string>) =>
  names.map((name) => `"${name}"`).join(", ");

export const profileEditor: ReadonlyArray<string> = [
  `DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${PROFILE_EDITOR}') THEN
    CREATE ROLE ${PROFILE_EDITOR} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;
END
$role$`,
  ...["public", "planning"].flatMap((schema) => [
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${PROFILE_EDITOR}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${PROFILE_EDITOR}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${PROFILE_EDITOR}`,
    `REVOKE ALL ON SCHEMA ${schema} FROM ${PROFILE_EDITOR}`,
  ]),
  `GRANT USAGE ON SCHEMA public TO ${PROFILE_EDITOR}`,
  `GRANT SELECT (${columns(READS)}) ON "public"."profiles" TO ${PROFILE_EDITOR}`,
  `GRANT UPDATE (${columns(WRITES)}) ON "public"."profiles" TO ${PROFILE_EDITOR}`,
  ...Object.entries(SETTINGS).map(
    ([name, value]) => `ALTER ROLE ${PROFILE_EDITOR} SET ${name} = '${value}'`,
  ),
];

export default statements(profileEditor);
