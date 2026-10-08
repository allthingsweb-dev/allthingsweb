/**
 * Creates draft_collab, or gives it a new password: the login role the
 * draft preview Worker (web/src/preview/) reads and writes draft
 * collaboration as, through its own Hyperdrive that never caches
 * (core/README.md, "Collaborating on a draft").
 *
 * It holds exactly DRAFT_COLLAB_GRANTS and DRAFT_COLLAB_FUNCTIONS and
 * nothing else:
 *
 * - On planning's collaboration tables, column grants: SELECT what the
 *   panel shows, and INSERT what collaborators hand in. No UPDATE, no
 *   DELETE, no TRUNCATE anywhere, so nothing handed in is ever changed or
 *   removed by it.
 * - No privilege on collaborators at all: it learns who is on an evening
 *   only through the `planning.collab_*` functions
 *   (core/migrations/0026_draft_collaboration.ts), which show emails to an
 *   evening's organizers alone. No SELECT on comments' author_email or on
 *   anything of the audit.
 * - Nothing else in planning (ideas, contacts, notes, sent posts...), and on
 *   `public` only which evening a slug names and whether it is a draft: the
 *   pages themselves are read as site_reader.
 * - Row security applies to it (it has no BYPASSRLS, which
 *   provisionLoginRole checks), so every row it reads or writes passes the
 *   tables' policies for the signer the Worker names in `collab.email`.
 *
 * Every run revokes what the role holds before granting, so a narrower list
 * here narrows the role. core/tests/draft-collab.test.ts makes the role
 * with these statements and checks what it may do, what it may not, and
 * that its privileges in the catalog are exactly these.
 *
 * Like site_sync it is created with SQL by the database owner, never in
 * Neon's console or API, because roles made there join neon_superuser. The
 * connection string goes straight into the repository's NEON_COLLAB_URL
 * secret and a 1Password item; it is never printed. Run it from the
 * repository root with the owner's connection string in the environment,
 * passed without printing it:
 *
 *   OWNER_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
 *     --project-id wispy-sea-75401301 --role-name neondb_owner --database-name neondb) \
 *     bun infra/scripts/draft-collab.ts
 *
 * VAULT names the 1Password vault (default: allthings).
 */
import {
  connectionStringFor,
  newPassword,
  provisionLoginRole,
  storeConnectionString,
} from "./login-role.ts";

export const DRAFT_COLLAB = "draft_collab";

interface ColumnGrants {
  readonly select?: ReadonlyArray<string>;
  readonly insert?: ReadonlyArray<string>;
}

/** Each table's columns the role reads and adds, schema-qualified. */
export const DRAFT_COLLAB_GRANTS: Readonly<Record<string, ColumnGrants>> = {
  // Which evening a slug names, and whether it is still being made.
  "public.events": { select: ["id", "slug", "is_draft", "end_date"] },
  "planning.rounds": {
    select: ["id", "event_id", "position", "title", "questions", "backups"],
  },
  "planning.brief_sections": {
    select: [
      "id",
      "event_id",
      "position",
      "heading",
      "body",
      "audiences",
      "updated_at",
    ],
  },
  "planning.tasks": {
    select: [
      "id",
      "event_id",
      "title",
      "due_on",
      "role",
      "collaborator_id",
      "done_at",
    ],
  },
  "planning.logistics_items": {
    select: ["id", "event_id", "position", "label", "detail"],
  },
  "planning.logistics_confirmations": {
    select: [
      "id",
      "event_id",
      "item_id",
      "collaborator_id",
      "answer",
      "note",
      "created_at",
    ],
    insert: ["id", "event_id", "item_id", "collaborator_id", "answer", "note"],
  },
  "planning.round_submissions": {
    select: [
      "id",
      "event_id",
      "round_id",
      "collaborator_id",
      "stage",
      "key_id",
      "nonce",
      "ciphertext",
      "created_at",
    ],
    // The id is the Worker's, made before sealing: it is bound into the seal.
    insert: [
      "id",
      "event_id",
      "round_id",
      "collaborator_id",
      "stage",
      "key_id",
      "nonce",
      "ciphertext",
    ],
  },
  "planning.reviews": {
    select: [
      "id",
      "round_submission_id",
      "logistics_confirmation_id",
      "decision",
      "note",
      "reviewer",
      "created_at",
    ],
  },
  "planning.comments": {
    select: [
      "id",
      "event_id",
      "collaborator_id",
      "author_name",
      "section_id",
      "round_id",
      "body",
      "created_at",
    ],
    insert: [
      "id",
      "event_id",
      "collaborator_id",
      "author_name",
      "author_email",
      "section_id",
      "round_id",
      "body",
    ],
  },
  "planning.collab_audit": {
    insert: [
      "actor_email",
      "event_id",
      "action",
      "target_id",
      "outcome",
      "request_id",
      "detail",
    ],
  },
};

/** The functions the role may execute, by signature: everything the policies and the panel ask. */
export const DRAFT_COLLAB_FUNCTIONS: ReadonlyArray<string> = [
  "planning.collab_email()",
  "planning.collab_is_organizer()",
  "planning.collab_memberships()",
  "planning.collab_has_role(uuid, text[])",
  "planning.collab_hosts(uuid)",
  "planning.collab_roster(uuid)",
  "planning.collab_recent_actions(timestamp with time zone, text[])",
];

/**
 * Bounds on every session, tighter than site_sync's: each request is a
 * handful of short statements, and a page should fail fast, not hang.
 */
export const DRAFT_COLLAB_SETTINGS = {
  statement_timeout: "10s",
  lock_timeout: "3s",
  idle_in_transaction_session_timeout: "15s",
} as const;

const quoted = (columns: ReadonlyArray<string>) =>
  columns.map((column) => `"${column}"`).join(", ");

const qualified = (table: string) => {
  const [schema, name] = table.split(".");
  return `"${schema}"."${name}"`;
};

/** The SQL that leaves `role` with exactly the grants, functions and settings above, run as the owner. */
export function grantStatements(role = DRAFT_COLLAB): string[] {
  const statements: string[] = [];
  for (const schema of ["public", "planning"]) {
    statements.push(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}`,
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${role}`,
      `REVOKE ALL ON SCHEMA ${schema} FROM ${role}`,
      `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
    );
  }
  statements.push(
    ...DRAFT_COLLAB_FUNCTIONS.map(
      (signature) => `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`,
    ),
  );
  for (const [table, grants] of Object.entries(DRAFT_COLLAB_GRANTS)) {
    for (const privilege of ["select", "insert"] as const) {
      const columns = grants[privilege];
      if (columns !== undefined && columns.length > 0) {
        statements.push(
          `GRANT ${privilege.toUpperCase()} (${quoted(columns)}) ON ${qualified(table)} TO ${role}`,
        );
      }
    }
  }
  for (const [name, value] of Object.entries(DRAFT_COLLAB_SETTINGS)) {
    statements.push(`ALTER ROLE ${role} SET ${name} = '${value}'`);
  }
  return statements;
}

const item = "allthings draft_collab";

async function main(): Promise<void> {
  const owner = process.env["OWNER_URL"];
  if (!owner) throw new Error("OWNER_URL is required (see this file's header)");
  const vault = process.env["VAULT"] ?? "allthings";

  const password = newPassword();
  const sql = new Bun.SQL(owner);
  const created = await sql.begin(async (transaction) => {
    const isNew = await provisionLoginRole(transaction, DRAFT_COLLAB, password);
    for (const statement of grantStatements()) {
      await transaction.unsafe(statement);
    }
    return isNew;
  });
  await sql.end();

  await storeConnectionString({
    value: connectionStringFor(owner, DRAFT_COLLAB, password),
    secret: "NEON_COLLAB_URL",
    item,
    vault,
    notes:
      "The draft preview's connection to production for draft collaboration (its Worker's Collab Hyperdrive). Rotate with infra/scripts/draft-collab.ts in allthingsweb-dev/allthingsweb.",
  });
  console.log(
    `✓ ${DRAFT_COLLAB} ${created ? "created" : "has a new password"}, column grants on ${Object.keys(DRAFT_COLLAB_GRANTS).length} tables; NEON_COLLAB_URL and 1Password ("${item}" in ${vault}) updated`,
  );
}

if (import.meta.main) await main();
