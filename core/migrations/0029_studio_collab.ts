import { statements } from "./statements.ts";

/**
 * The studio runs `bun run collab` (README, "The studio's connection"):
 * the collaboration's ten tables (migrations/0026_draft_collaboration.ts)
 * have row security, which only their owner bypasses, so the studio role
 * (infra/scripts/studio.ts) gets a policy of its own on each that shows it
 * every row and lets it write any. What it may actually do is its grants'
 * (STUDIO_GRANTS: reads, and the writes `collab` makes, by column); the
 * policy only stops row security from hiding rows from it. draft_collab's
 * policies are unchanged, and no other role is named.
 *
 * - `studio` is made here, with no login, where it doesn't exist yet (a
 *   new database, the tests): a policy names an existing role. On
 *   production the script made it first; there this does nothing, and
 *   the script's next run keeps it as it is.
 * - `planning.collab_row_counts()` counts every row of the ten tables, as
 *   their owner (SECURITY DEFINER, with a fixed search path). A command
 *   that must see every row (`collab`, and above all `collab access sync`,
 *   which sets Access's list to the invitations it reads) compares those
 *   counts with what it sees, in the same statement, and refuses when they
 *   differ: a role row security holds back reads short, never empty
 *   silently. PUBLIC may not execute it; the studio's script grants it.
 *
 * Ships with the app's drizzle migration 0041_studio_collab, which makes
 * the same change.
 */

export const collabTables = [
  "rounds",
  "collaborators",
  "brief_sections",
  "tasks",
  "logistics_items",
  "logistics_confirmations",
  "round_submissions",
  "reviews",
  "comments",
  "collab_audit",
] as const;

/** The studio role, without a login, unless it is there already. */
export const studioRoleIfMissing = `DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'studio') THEN
    CREATE ROLE studio NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;
END
$role$`;

export const collabRowCounts = `CREATE FUNCTION "planning"."collab_row_counts"()
  RETURNS TABLE ("relname" text, "rows" bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
${collabTables.map((table) => `  SELECT '${table}'::text, count(*) FROM planning.${table}`).join("\n  UNION ALL\n")}
$$`;

export const studioCollab: ReadonlyArray<string> = [
  studioRoleIfMissing,
  ...collabTables.map(
    (table) =>
      `CREATE POLICY "${table}_studio" ON "planning"."${table}" AS PERMISSIVE FOR ALL TO "studio" USING (true) WITH CHECK (true)`,
  ),
  collabRowCounts,
  `REVOKE ALL ON FUNCTION "planning"."collab_row_counts"() FROM PUBLIC`,
];

export default statements(studioCollab);
