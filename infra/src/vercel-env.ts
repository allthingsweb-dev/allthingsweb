import * as Command from "alchemy/Command";
import type { Input } from "alchemy";
import type * as Redacted from "effect/Redacted";

/**
 * The Vercel CLI infra/package.json pins, installed with infra's
 * dependencies. One install, not `bunx` at each write: a prod deploy runs
 * the writes in parallel, and parallel `bunx` runs raced to link the package
 * (`EEXIST`) on Nov 2 (docs/r2-migration.md).
 *
 * Relative to infra/, where every deploy runs (`bun run deploy`, and the
 * commands run from the directory the deploy started in), so the command,
 * which Alchemy keeps in state, is the same on every machine and checkout.
 */
export const VERCEL = "./node_modules/.bin/vercel";
const PROJECT = "--scope andrelandgraf --project allthingsweb";

/**
 * Writes one environment variable to the allthingsweb Vercel project. The
 * value reaches the Vercel CLI on stdin, so it never appears in a command
 * line, log or Alchemy state diff. It runs again only when the value, name or
 * targets change.
 */
export const VercelEnv = (
  name: string,
  value: Input<string | Redacted.Redacted>,
  { sensitive, targets }: { sensitive: boolean; targets: readonly string[] },
) =>
  Command.Exec(`Vercel${name}`, {
    command: targets
      .map(
        (target) =>
          // Vercel can't store sensitive values for development.
          `printf %s "$VALUE" | "${VERCEL}" env add ${name} ${target} ${PROJECT} --force --yes ${sensitive && target !== "development" ? "--sensitive" : "--no-sensitive"}`,
      )
      .join(" && "),
    shell: true,
    env: { VALUE: value },
    memo: { include: [] },
  });
