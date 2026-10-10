import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { orDataSourceError } from "../sql.ts";

/**
 * Who may reach planning (migrations/0012_planning.ts) on a database, read
 * from its catalog: the proof that the site's roles can't.
 *
 * site_reader reads production for every stage's Hyperdrive and site_sync
 * writes it for the hourly sync (infra/scripts/site-reader.ts,
 * site-sync.ts). Neither may use the planning schema, nor hold any
 * privilege on what is in it (its functions too: Postgres lets PUBLIC
 * execute a new function unless it is revoked), and PUBLIC, which every
 * role belongs to, may hold none either. `plan audit` runs this against production; the tests
 * run it on roles made with the scripts' own statements.
 *
 * Neon's own roles (neon_superuser, its member "reader", and the owner) can
 * read everything through pg_read_all_data; they belong to whoever runs the
 * Neon project, and nothing public connects as them.
 */

/** The roles the site connects as, which must never reach planning. */
export const siteRoles = ["site_reader", "site_sync"] as const;

/** A privilege someone holds on planning who must not. */
export interface Exposure {
  readonly role: string;
  readonly object: string;
  readonly privilege: string;
}

export interface PlanningAudit {
  /** Whether this database has the planning schema at all; an audit of none proves nothing. */
  readonly schemaExists: boolean;
  /** Every relation in the planning schema, by name. */
  readonly relations: ReadonlyArray<string>;
  /** Site roles that exist on this database, each checked. */
  readonly checkedRoles: ReadonlyArray<string>;
  /** What a site role or PUBLIC may do with planning; empty when private. */
  readonly exposures: ReadonlyArray<Exposure>;
}

const Row = Schema.Struct({
  role: Schema.String,
  object: Schema.String,
  privilege: Schema.String,
});

export const auditPlanning = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const [schema] = yield* sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'planning'
    ) AS "exists"`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ exists: Schema.Boolean })),
      ),
    ),
  );
  const relations = yield* sql`
    SELECT c.relname AS name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'planning' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ORDER BY c.relname`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ name: Schema.String })),
      ),
    ),
  );
  const roles = yield* sql`
    SELECT rolname AS name FROM pg_catalog.pg_roles
    WHERE rolname IN ${sql.in([...siteRoles])}
    ORDER BY rolname`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ name: Schema.String })),
      ),
    ),
  );
  const checked = roles.map((role) => role.name);
  const exposures = yield* sql`
    WITH roles AS (
      SELECT oid, rolname FROM pg_catalog.pg_roles WHERE rolname IN ${sql.in(checked.length === 0 ? [""] : checked)}
    ), planning AS (
      SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'planning'
    ), relations AS (
      SELECT c.oid, c.relname, c.relkind FROM pg_catalog.pg_class c
      WHERE c.relnamespace = (SELECT oid FROM planning)
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ), schema_privileges AS (
      SELECT r.rolname AS role, 'schema planning' AS object, p.privilege
      FROM roles r, planning s, unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
      WHERE pg_catalog.has_schema_privilege(r.oid, s.oid, p.privilege)
    ), table_privileges AS (
      SELECT r.rolname, 'planning.' || c.relname, p.privilege
      FROM roles r, relations c, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
      WHERE c.relkind <> 'S' AND pg_catalog.has_table_privilege(r.oid, c.oid, p.privilege)
    ), column_privileges AS (
      SELECT r.rolname, 'planning.' || c.relname || ' (a column)', p.privilege
      FROM roles r, relations c, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilege)
      WHERE c.relkind <> 'S' AND pg_catalog.has_any_column_privilege(r.oid, c.oid, p.privilege)
        AND NOT pg_catalog.has_table_privilege(r.oid, c.oid, p.privilege)
    ), routines AS (
      SELECT p.oid, p.proacl, p.proowner FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = (SELECT oid FROM planning)
    ), routine_privileges AS (
      SELECT r.rolname, f.oid::pg_catalog.regprocedure::text, 'EXECUTE'
      FROM roles r, routines f
      WHERE pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE')
    ), sequence_privileges AS (
      SELECT r.rolname, 'planning.' || c.relname, p.privilege
      FROM roles r, relations c, unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilege)
      WHERE c.relkind = 'S' AND pg_catalog.has_sequence_privilege(r.oid, c.oid, p.privilege)
    ), public_grants AS (
      SELECT 'PUBLIC', 'schema planning', a.privilege_type
      FROM pg_catalog.pg_namespace s, aclexplode(s.nspacl) a
      WHERE s.oid = (SELECT oid FROM planning) AND a.grantee = 0
      UNION ALL
      SELECT 'PUBLIC', 'planning.' || c.relname, a.privilege_type
      FROM relations c JOIN pg_catalog.pg_class k ON k.oid = c.oid, aclexplode(k.relacl) a
      WHERE a.grantee = 0
      UNION ALL
      SELECT 'PUBLIC', 'planning.' || c.relname || '.' || t.attname, a.privilege_type
      FROM relations c JOIN pg_catalog.pg_attribute t ON t.attrelid = c.oid, aclexplode(t.attacl) a
      WHERE a.grantee = 0 AND t.attnum > 0 AND NOT t.attisdropped
      UNION ALL
      -- A function nobody granted or revoked anything on has a null ACL,
      -- which Postgres reads as EXECUTE for PUBLIC.
      SELECT 'PUBLIC', f.oid::pg_catalog.regprocedure::text, a.privilege_type
      FROM routines f, aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
      WHERE a.grantee = 0
    )
    SELECT role, object, privilege FROM (
      SELECT * FROM schema_privileges
      UNION ALL SELECT * FROM table_privileges
      UNION ALL SELECT * FROM column_privileges
      UNION ALL SELECT * FROM sequence_privileges
      UNION ALL SELECT * FROM routine_privileges
      UNION ALL SELECT * FROM public_grants
    ) found
    ORDER BY role, object, privilege`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
  );
  return {
    schemaExists: schema?.exists === true,
    relations: relations.map((relation) => relation.name),
    checkedRoles: checked,
    exposures,
  } satisfies PlanningAudit;
}).pipe(orDataSourceError);

/**
 * The collaboration's tables (migrations/0026_draft_collaboration.ts): each
 * has row security, and planning.collab_row_counts()
 * (migrations/0029_studio_collab.ts) counts every row of each, as their
 * owner.
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
export type CollabTable = (typeof collabTables)[number];

/**
 * Whether this role sees every row of each of the collaboration's `tables`:
 * it may SELECT each and count them as their owner does
 * (`planning.collab_row_counts()`), and what it counts is every row, read
 * in one statement, so one snapshot. The owner does, and so does the studio
 * through its own policies; a role row security holds back reads short, and
 * a table read short would say all is well (no rounds, nobody invited), so
 * code that must see every row asks this first and refuses otherwise.
 */
export const readsEveryRow = (tables: ReadonlyArray<CollabTable>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const [may] = yield* sql<{ may: boolean }>`
      SELECT count(*) = ${tables.length}
        AND COALESCE(bool_and(pg_catalog.has_table_privilege(c.oid, 'SELECT')), false)
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
          WHERE pn.nspname = 'planning' AND p.proname = 'collab_row_counts'
            AND pg_catalog.has_function_privilege(p.oid, 'EXECUTE')
        ) AS may
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'planning' AND c.relname IN ${sql.in([...tables])}`;
    if (may?.may !== true) return false;
    // The names are collabTables', never input.
    const [seen] = yield* sql.unsafe<{ sees: boolean }>(
      `WITH owner AS (SELECT relname, "rows" FROM planning.collab_row_counts())
       SELECT ${tables
         .map(
           (table) =>
             `(SELECT count(*) FROM planning.${table}) = (SELECT "rows" FROM owner WHERE relname = '${table}')`,
         )
         .join(" AND ")} AS sees`,
    );
    return seen?.sees === true;
  });

/** Whether the audit proves planning private: it exists, and nothing exposes it. */
export const isPrivate = (audit: PlanningAudit): boolean =>
  audit.schemaExists && audit.exposures.length === 0;

/** The audit as lines to read. */
export function formatAudit(audit: PlanningAudit): string {
  if (!audit.schemaExists) {
    return "✗ this database has no planning schema: nothing to prove (run bun run migrate first)";
  }
  const lines = [
    `planning: ${audit.relations.length} relations (${audit.relations.join(", ")})`,
    `checked: ${audit.checkedRoles.length === 0 ? "no site role exists here" : audit.checkedRoles.join(", ")}, and PUBLIC`,
  ];
  if (audit.exposures.length === 0) {
    lines.push("✓ private: no site role and not PUBLIC may use it");
  } else {
    lines.push(`✗ exposed (${audit.exposures.length}):`);
    for (const exposure of audit.exposures) {
      lines.push(
        `  ${exposure.role} ${exposure.privilege} on ${exposure.object}`,
      );
    }
  }
  return lines.join("\n");
}
