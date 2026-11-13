/**
 * Gives proposal_intake a login and a new password: the role the site's
 * Worker sends talk proposals as (core's README, "Taking proposals from
 * anyone"). Its privileges aren't this script's: migration 0040_proposals
 * (core/migrations/0040_proposals.ts) makes the role without a login and
 * grants it INSERT of a proposal's columns and nothing else
 * (core/src/proposal-intake-role.ts, which imports nothing), and this
 * script only checks them. So run `bun run migrate` first; on a database
 * where the migration hasn't run, it refuses and changes nothing.
 *
 * Like the studio it is made with SQL by the database owner, never in
 * Neon's console or API, because roles made there join neon_superuser. The
 * connection string goes straight into the 1Password item "allthings
 * proposal_intake" (field `credential`) in the allthings vault, through
 * `op` (with OP_SERVICE_ACCOUNT_TOKEN, or your own session); it is never
 * printed, and no repository secret holds it: only a prod deploy reads it,
 * for the site's intake. Run it from the repository root with the owner's connection string
 * in the environment, passed without printing it, first as a plan, then to
 * apply:
 *
 *   OWNER_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
 *     --project-id wispy-sea-75401301 --org-id org-broad-sea-60121176 \
 *     --role-name neondb_owner --database-name neondb) \
 *     bun infra/scripts/proposal-intake.ts --dry-run
 *
 * --dry-run gives the role a login with a throwaway password in a
 * transaction that is rolled back, and prints its privileges, its settings
 * and where its credential would go. --apply does it, committing only once
 * the catalog holds exactly the migration's privileges, then checks that the
 * connection string read back from 1Password signs in as proposal_intake.
 * Rerunning --apply rotates the password.
 *
 * VAULT names the 1Password vault (default: allthings).
 */
import {
  PROPOSAL_INTAKE,
  PROPOSAL_INTAKE_INSERTS,
  PROPOSAL_INTAKE_SETTINGS,
} from "../../core/src/proposal-intake-role.ts";
import {
  connectionStringFor,
  newPassword,
  provisionLoginRole,
  run,
  type Statements,
  storeItem,
} from "./login-role.ts";
import { grantedQuery } from "./studio.ts";

export { PROPOSAL_INTAKE };

/** The 1Password item its connection string is kept in. */
export const PROPOSAL_INTAKE_ITEM = "allthings proposal_intake";

/** What grantedQuery reads for the role once the migration has run: one line each. */
export function expectedPrivileges(): string[] {
  return [
    "schema planning usage",
    ...PROPOSAL_INTAKE_INSERTS.map(
      (column) => `planning.proposals insert ${column}`,
    ),
  ].toSorted();
}

/** The role's settings as the catalog holds them (`name=value`), sorted. */
export const expectedSettings = (): string[] =>
  Object.entries(PROPOSAL_INTAKE_SETTINGS)
    .map(([name, value]) => `${name}=${value}`)
    .toSorted();

const rows = async <A>(
  sql: Statements,
  query: string,
  values: ReadonlyArray<unknown>,
): Promise<ReadonlyArray<A>> => (await sql.unsafe(query, values)) as A[];

/**
 * Refuses unless the role exists with exactly the migration's privileges
 * and settings: a database the migration hasn't reached, or a role changed
 * by hand since.
 */
async function checkRole(sql: Statements): Promise<void> {
  const existing = await rows(
    sql,
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [PROPOSAL_INTAKE],
  );
  if (existing.length === 0) {
    throw new Error(
      `${PROPOSAL_INTAKE} doesn't exist: run core's migrations first (\`bun run migrate\`, migration 0040_proposals). Nothing was changed.`,
    );
  }
  const granted = (
    await rows<{ grant: string }>(sql, grantedQuery, [PROPOSAL_INTAKE])
  ).map((row) => row.grant);
  const expected = expectedPrivileges();
  const wrong = [
    ...expected.filter((line) => !granted.includes(line)).map((l) => `- ${l}`),
    ...granted.filter((line) => !expected.includes(line)).map((l) => `+ ${l}`),
  ];
  if (wrong.length > 0) {
    throw new Error(
      `${PROPOSAL_INTAKE}'s privileges aren't what core's migrations grant (0040), so nothing was changed:\n${wrong.join("\n")}`,
    );
  }
  const settings = (
    await rows<{ setting: string }>(
      sql,
      `SELECT unnest(s.setconfig) AS setting FROM pg_db_role_setting s
         JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1 ORDER BY 1`,
      [PROPOSAL_INTAKE],
    )
  ).map((row) => row.setting);
  if (settings.join("\n") !== expectedSettings().join("\n")) {
    throw new Error(
      `${PROPOSAL_INTAKE}'s settings are ${settings.join(", ") || "none"}, not ${expectedSettings().join(", ")}, so nothing was changed.`,
    );
  }
}

/** Rolls the plan's transaction back once it has shown what it would do. */
class Planned extends Error {}

/** `--dry-run`: everything --apply does to the database, rolled back; nothing stored. */
async function plan(owner: string, vault: string): Promise<void> {
  const sql = new Bun.SQL(owner);
  try {
    await sql.begin(async (transaction) => {
      await checkRole(transaction);
      const [before] = await rows<{ login: boolean }>(
        transaction,
        "SELECT rolcanlogin AS login FROM pg_roles WHERE rolname = $1",
        [PROPOSAL_INTAKE],
      );
      await provisionLoginRole(transaction, PROPOSAL_INTAKE, newPassword());
      await checkRole(transaction);
      console.log(
        [
          `${PROPOSAL_INTAKE} would ${before?.login === true ? "get a new password" : "get a login and a password"}, keeping the ${expectedPrivileges().length} privileges on planning.proposals:`,
          ...expectedPrivileges().map((line) => `  ${line}`),
          `Settings: ${expectedSettings().join(", ")}.`,
          `Its connection string would go to 1Password, "${PROPOSAL_INTAKE_ITEM}" (credential) in ${vault}, and nowhere else.`,
          "Nothing was changed. Run it again with --apply to do it.",
        ].join("\n"),
      );
      throw new Planned();
    });
  } catch (error) {
    if (!(error instanceof Planned)) throw error;
  } finally {
    await sql.end();
  }
}

/**
 * `--apply`: the login and a new password, committed only while the role
 * holds exactly the migration's privileges; then the connection string to
 * 1Password, read back and signed in with. Nothing it reads or stores is
 * printed.
 */
async function apply(owner: string, vault: string): Promise<void> {
  // 1Password first, with the reads storeItem starts with: a password
  // changed while op can't store it would leave the item holding the old one.
  try {
    await run(["op", "item", "list", "--vault", vault, "--format", "json"]);
    await run(["op", "item", "template", "get", "API Credential"]);
  } catch (cause) {
    throw new Error(
      `1Password can't store "${PROPOSAL_INTAKE_ITEM}" in ${vault} yet (${cause instanceof Error ? cause.message : String(cause)}), so the password wasn't changed. Sign op in (your session, or OP_SERVICE_ACCOUNT_TOKEN) and rerun.`,
      { cause },
    );
  }
  const password = newPassword();
  const sql = new Bun.SQL(owner);
  try {
    await sql.begin(async (transaction) => {
      await checkRole(transaction);
      await provisionLoginRole(transaction, PROPOSAL_INTAKE, password);
      await checkRole(transaction);
    });
  } finally {
    await sql.end();
  }

  try {
    await storeItem({
      value: connectionStringFor(owner, PROPOSAL_INTAKE, password),
      item: PROPOSAL_INTAKE_ITEM,
      vault,
      notes:
        "Production connection for the site's Worker to take talk proposals: INSERT of a proposal's columns on planning.proposals, nothing else (core's README, \"Taking proposals from anyone\"). A prod deploy reads it. Rotate with infra/scripts/proposal-intake.ts in allthings-sf/allthingsweb, then deploy prod.",
    });
  } catch (cause) {
    throw new Error(
      `The role's password has changed, but 1Password ("${PROPOSAL_INTAKE_ITEM}" in ${vault}) may still hold the old one: ${cause instanceof Error ? cause.message : String(cause)}. Rerun this script once 1Password answers.`,
      { cause },
    );
  }

  // Read back what 1Password now holds, and sign in with it.
  const stored = (
    await run([
      "op",
      "read",
      ["op:/", vault, PROPOSAL_INTAKE_ITEM, "credential"].join("/"),
    ])
  ).trim();
  const editor = new Bun.SQL(stored);
  try {
    const [row] = (await editor.unsafe("SELECT current_user AS who")) as Array<{
      who: string;
    }>;
    if (row?.who !== PROPOSAL_INTAKE) {
      throw new Error(
        `1Password's "${PROPOSAL_INTAKE_ITEM}" signs in as someone else`,
      );
    }
  } finally {
    await editor.end();
  }
  console.log(
    `✓ ${PROPOSAL_INTAKE} has a login and a new password, with exactly the privileges core's migrations grant; 1Password ("${PROPOSAL_INTAKE_ITEM}" in ${vault}) updated, and it signs in as ${PROPOSAL_INTAKE}`,
  );
}

/** Plans (--dry-run) or applies (--apply) the login on the database at OWNER_URL. */
async function main(): Promise<void> {
  const owner = process.env["OWNER_URL"];
  if (!owner) throw new Error("OWNER_URL is required (see this file's header)");
  const vault = process.env["VAULT"] ?? "allthings";
  const mode = process.argv.slice(2);
  if (mode.length === 1 && mode[0] === "--dry-run") return plan(owner, vault);
  if (mode.length === 1 && mode[0] === "--apply") return apply(owner, vault);
  throw new Error(
    "Pass --dry-run to see what it would do, then --apply to do it (see this file's header).",
  );
}

if (import.meta.main) await main();
