/**
 * What site-reader.ts and site-sync.ts share: a login role created by the
 * database owner with SQL (never Neon's console or API, whose roles join
 * neon_superuser), a fresh password, and its connection string stored in a
 * repository secret and 1Password without ever being printed.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = "allthingsweb-dev/allthingsweb";

/** Runs a command with `input` on stdin; fails with its stderr, never its input. */
export async function run(
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

/** A new password. base64url is only letters, digits, "-" and "_": safe inside a SQL literal. */
export const newPassword = (): string => randomBytes(24).toString("base64url");

/**
 * Creates `role` as a login role with no attributes beyond LOGIN, or gives it
 * `password` if it exists. NOINHERIT: it never acts with another role's
 * privileges, even if someone grants it membership.
 */
export const loginRoleStatement = (
  role: string,
  password: string,
  exists: boolean,
): string =>
  exists
    ? `ALTER ROLE ${role} WITH LOGIN PASSWORD '${password}'`
    : `CREATE ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD '${password}'`;

/** Whether `role` exists, asked as the owner. */
export async function roleExists(sql: Bun.SQL, role: string): Promise<boolean> {
  const [row] = await sql`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
  return (row as { exists: boolean }).exists;
}

/** The owner's connection string for `role` instead, direct rather than pooled (Hyperdrive pools). */
export function connectionStringFor(
  owner: string,
  role: string,
  password: string,
): string {
  const url = new URL(owner);
  url.username = role;
  url.password = password;
  url.hostname = url.hostname.replace("-pooler", "");
  return url.toString();
}

/**
 * Writes `value` to the repository secret `secret`, then to the 1Password
 * item `item` in `vault` (1Password's own API Credential template, passed as
 * a file only this user can read and removed right after: op ignores the
 * values of a template piped on stdin). The secret comes first, so a
 * 1Password that refuses still leaves CI working; the error says which
 * store has the value.
 */
export async function storeConnectionString(options: {
  value: string;
  secret: string;
  item: string;
  vault: string;
  notes: string;
}): Promise<void> {
  await run(
    ["gh", "secret", "set", options.secret, "--repo", repo],
    options.value,
  );
  try {
    const template = JSON.parse(
      await run(["op", "item", "template", "get", "API Credential"]),
    ) as { title?: string; fields: Array<{ id: string; value?: string }> };
    template.title = options.item;
    for (const field of template.fields) {
      if (field.id === "credential") field.value = options.value;
      if (field.id === "notesPlain") field.value = options.notes;
    }
    const dir = await mkdtemp(join(tmpdir(), "login-role-"));
    try {
      const file = join(dir, "item.json");
      await writeFile(file, JSON.stringify(template), { mode: 0o600 });
      await run([
        "op",
        "item",
        "delete",
        options.item,
        "--vault",
        options.vault,
        "--archive",
      ]).catch(() => undefined);
      await run([
        "op",
        "item",
        "create",
        "--vault",
        options.vault,
        "--template",
        file,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (cause) {
    throw new Error(
      `${options.secret} is updated, but 1Password ("${options.item}") is not: ${cause instanceof Error ? cause.message : String(cause)}. Rerun to rotate again once 1Password answers.`,
      { cause },
    );
  }
}
