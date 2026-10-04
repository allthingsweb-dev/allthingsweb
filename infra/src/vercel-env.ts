import * as Command from "alchemy/Command";
import type { Input } from "alchemy";
import type * as Redacted from "effect/Redacted";

const VERCEL = "bunx vercel@62.2.0";
const PROJECT = "--scope andrelandgraf --project allthingsweb";

/**
 * Writes one environment variable to the allthingsweb Vercel project. The
 * value reaches the Vercel CLI on stdin, so it never appears in a command
 * line, log or Alchemy state diff. It runs again only when the value, name or
 * targets change.
 */
export const VercelEnv = (
  name: string,
  value: Input<string | Redacted.Redacted<string>>,
  { sensitive, targets }: { sensitive: boolean; targets: readonly string[] },
) =>
  Command.Exec(`Vercel${name}`, {
    command: targets
      .map(
        (target) =>
          // Vercel can't store sensitive values for development.
          `printf %s "$VALUE" | ${VERCEL} env add ${name} ${target} ${PROJECT} --force --yes ${sensitive && target !== "development" ? "--sensitive" : "--no-sensitive"}`,
      )
      .join(" && "),
    shell: true,
    env: { VALUE: value },
    memo: { include: [] },
  });
