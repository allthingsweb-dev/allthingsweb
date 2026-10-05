/**
 * Creates site_reader, or gives it a new password: the login role every stage
 * but prod reads production's database with, through Hyperdrive. It may only
 * SELECT the tables the public site reads, and every transaction it starts is
 * read-only.
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
 * VAULT names the 1Password vault (default: Private).
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  "redirects",
] as const;

const repo = "allthingsweb-dev/allthingsweb";
const item = "allthings site_reader";

/** Runs a command with `input` on stdin; fails with its stderr, never its input. */
async function run(
  command: ReadonlyArray<string>,
  input = "",
): Promise<string> {
  const child = Bun.spawn([...command], {
    stdin: new Response(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`${command.slice(0, 3).join(" ")} failed: ${err.trim()}`);
  return out;
}

async function main(): Promise<void> {
  const owner = process.env["OWNER_URL"];
  if (!owner) throw new Error("OWNER_URL is required (see this file's header)");
  const vault = process.env["VAULT"] ?? "Private";

  // base64url is only letters, digits, "-" and "_": safe inside a SQL literal.
  const password = randomBytes(24).toString("base64url");
  const sql = new Bun.SQL(owner);
  const [{ exists }] = await sql`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${SITE_READER}) AS exists`;
  await sql.unsafe(
    exists
      ? `ALTER ROLE ${SITE_READER} WITH LOGIN PASSWORD '${password}'`
      : `CREATE ROLE ${SITE_READER} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD '${password}'`,
  );
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${SITE_READER}`);
  await sql.unsafe(
    `GRANT SELECT ON ${SITE_TABLES.map((t) => `public.${t}`).join(", ")} TO ${SITE_READER}`,
  );
  await sql.unsafe(
    `ALTER ROLE ${SITE_READER} SET default_transaction_read_only = on`,
  );
  await sql.end();

  const url = new URL(owner);
  url.username = SITE_READER;
  url.password = password;
  url.hostname = url.hostname.replace("-pooler", "");
  const connectionString = url.toString();

  await run(
    ["gh", "secret", "set", "NEON_READER_URL", "--repo", repo],
    connectionString,
  );
  // 1Password's own API Credential template, filled in and passed as a file
  // only this user can read, removed right after: op ignores the values of a
  // template piped on stdin.
  const template = JSON.parse(
    await run(["op", "item", "template", "get", "API Credential"]),
  ) as { title?: string; fields: Array<{ id: string; value?: string }> };
  template.title = item;
  for (const field of template.fields) {
    if (field.id === "credential") field.value = connectionString;
    if (field.id === "notesPlain") {
      field.value = `Read-only connection to production for Hyperdrive on every non-prod stage. Rotate with infra/scripts/site-reader.ts in ${repo}.`;
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "site-reader-"));
  try {
    const file = join(dir, "item.json");
    await writeFile(file, JSON.stringify(template), { mode: 0o600 });
    await run([
      "op",
      "item",
      "delete",
      item,
      "--vault",
      vault,
      "--archive",
    ]).catch(() => undefined);
    await run(["op", "item", "create", "--vault", vault, "--template", file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log(
    `✓ ${SITE_READER} ${exists ? "has a new password" : "created"}, SELECT on ${SITE_TABLES.length} tables; NEON_READER_URL and 1Password ("${item}" in ${vault}) updated`,
  );
}

if (import.meta.main) await main();
