/**
 * Creates site_reader, or gives it a new password: the login role every stage
 * but prod reads production's database with, through Hyperdrive. It may only
 * SELECT the tables the public site reads, and the migrator's record of what
 * it has applied (MIGRATION_RECORD, which CI's migration guard reads), and
 * every transaction it starts is read-only.
 *
 * It is created with SQL by the database owner, not in Neon's console or API,
 * because roles made there join neon_superuser: Neon's own "reader" role can
 * insert, create roles and bypass row-level security.
 *
 * The new connection string goes straight into the repository's
 * NEON_READER_URL secret and a 1Password item, for deploys from a maintainer's
 * machine; it is never printed. Run it from the repository root with the
 * owner's connection string in the environment, passed without printing it:
 *
 *   OWNER_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
 *     --project-id wispy-sea-75401301 --role-name neondb_owner --database-name neondb) \
 *     bun infra/scripts/site-reader.ts
 *
 * VAULT names the 1Password vault (default: allthings, the one vault this
 * repository reads its credentials from, and the only one agents' service
 * account can read).
 */
import {
  connectionStringFor,
  newPassword,
  provisionLoginRole,
  storeConnectionString,
} from "./login-role.ts";

export const SITE_READER = "site_reader";

/** The tables the public site reads; a new one is added here and the script rerun. */
export const SITE_TABLES = [
  "events",
  "talks",
  "event_talks",
  "talk_speakers",
  "profiles",
  "sponsors",
  "event_sponsors",
  "images",
  "event_images",
  "event_people",
  "event_posts",
  "external_talks",
  "event_schedule_items",
  "event_notes",
  "profile_slugs",
  "redirects",
  "event_slugs",
] as const;

/**
 * Core's record of applied migrations (core/src/migrator.ts), which the
 * migration guard (core/scripts/migration-guard.ts) reads to know which
 * numbers production has taken. Only the record: nothing else in its schema.
 */
export const MIGRATION_RECORD = {
  schema: "effect_sql",
  table: "migrations",
} as const;

/**
 * The SQL that leaves `role` with SELECT on SITE_TABLES and the migration
 * record, and read-only transactions, run as the owner. It names each table: nothing is granted
 * on a whole schema, so a table added anywhere (planning's, say) is
 * private until it is listed here.
 */
export function grantStatements(role = SITE_READER): string[] {
  return [
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT ON ${SITE_TABLES.map((t) => `public.${t}`).join(", ")} TO ${role}`,
    `GRANT USAGE ON SCHEMA ${MIGRATION_RECORD.schema} TO ${role}`,
    `GRANT SELECT ON ${MIGRATION_RECORD.schema}.${MIGRATION_RECORD.table} TO ${role}`,
    `ALTER ROLE ${role} SET default_transaction_read_only = on`,
  ];
}

const item = "allthings site_reader";

async function main(): Promise<void> {
  const owner = process.env["OWNER_URL"];
  if (!owner) throw new Error("OWNER_URL is required (see this file's header)");
  const vault = process.env["VAULT"] ?? "allthings";

  const password = newPassword();
  const sql = new Bun.SQL(owner);
  const created = await sql.begin(async (transaction) => {
    const isNew = await provisionLoginRole(transaction, SITE_READER, password);
    for (const statement of grantStatements()) {
      await transaction.unsafe(statement);
    }
    return isNew;
  });
  await sql.end();

  await storeConnectionString({
    value: connectionStringFor(owner, SITE_READER, password),
    secret: "NEON_READER_URL",
    item,
    vault,
    notes:
      "Read-only connection to production for Hyperdrive on every non-prod stage. Rotate with infra/scripts/site-reader.ts in allthingsweb-dev/allthingsweb.",
  });
  console.log(
    `✓ ${SITE_READER} ${created ? "created" : "has a new password"}, SELECT on ${SITE_TABLES.length} tables; NEON_READER_URL and 1Password ("${item}" in ${vault}) updated`,
  );
}

if (import.meta.main) await main();
