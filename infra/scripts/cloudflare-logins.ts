/**
 * The Cloudflare logins a maintainer already has, used by scripts without
 * anyone creating a token by hand:
 *
 * - wrangler's OAuth login, on the account that holds the media bucket now,
 *   which may read it through Cloudflare's REST API;
 * - the cf CLI's login on the allthings account (the one ci-token.sh uses),
 *   which may create account tokens.
 *
 * Tokens only ever pass through memory: commands' output is parsed, never
 * printed, and a failing command shows its stderr alone.
 */
import { bucketTokenPolicies, s3CredentialsOf } from "../src/r2-token.ts";

const WRANGLER = ["bunx", "wrangler@4.147.0"] as const;
const CF = ["bunx", "cf@1.0.0-beta.12"] as const;

/** Runs a command and returns its stdout; fails with its stderr, never its stdout. */
async function output(
  command: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
): Promise<string> {
  const child = Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    // cf prints guidance for agents on stderr; keep only what explains a failure.
    const reason = err
      .split("\n")
      .filter(
        (line) =>
          !/AGENT|=== |cli search|Keep cf|Never include|It returns|Run `|For API|first port/.test(
            line,
          ),
      )
      .join("\n")
      .trim();
    throw new Error(`${command.slice(0, 4).join(" ")} failed: ${reason}`);
  }
  return out;
}

/**
 * wrangler's OAuth token. wrangler refreshes it when it has expired, so
 * asking again gives one that works.
 */
export async function wranglerToken(): Promise<string> {
  const answer = JSON.parse(
    await output([...WRANGLER, "auth", "token", "--json"]),
  ) as { token?: unknown };
  if (typeof answer.token !== "string" || answer.token === "") {
    throw new Error(
      "wrangler is not signed in: run `bunx wrangler login` with the account that holds the media bucket",
    );
  }
  return answer.token;
}

/** The one account wrangler's login reaches, or an error asking which. */
export async function wranglerAccount(): Promise<string> {
  const whoami = JSON.parse(
    await output([...WRANGLER, "whoami", "--json"]),
  ) as { accounts?: ReadonlyArray<{ id: string }> };
  const accounts = whoami.accounts ?? [];
  const [only] = accounts;
  if (accounts.length !== 1 || only === undefined) {
    throw new Error(
      `wrangler's login reaches ${accounts.length} accounts: set SOURCE_ACCOUNT_ID to the one holding the media bucket`,
    );
  }
  return only.id;
}

/** S3 credentials for one bucket, and how to delete the token behind them. */
export interface BucketToken {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly revoke: () => Promise<void>;
}

const result = (json: string): unknown => {
  const parsed = JSON.parse(json) as unknown;
  return typeof parsed === "object" && parsed !== null && "result" in parsed
    ? parsed.result
    : parsed;
};

/**
 * Creates an account token that may read and write `bucket`'s objects and
 * nothing else, with the cf CLI's login (`profile`) on `accountId`.
 */
export async function createBucketToken(options: {
  readonly accountId: string;
  readonly bucket: string;
  readonly profile: string;
  readonly name: string;
}): Promise<BucketToken> {
  const env = {
    CLOUDFLARE_ACCOUNT_ID: options.accountId,
    // cf 1.0.0-beta.12 fails to reach Cloudflare over IPv6 on some networks.
    NODE_OPTIONS: "--dns-result-order=ipv4first",
  };
  const cf = (...args: Array<string>) =>
    output([...CF, "--profile", options.profile, ...args], env);
  const groups = result(
    await cf("accounts", "tokens", "permission-groups", "list"),
  ) as ReadonlyArray<{ id: string; name: string }>;
  const policies = bucketTokenPolicies(
    groups,
    options.accountId,
    options.bucket,
  );
  const created = result(
    await cf(
      "accounts",
      "tokens",
      "create",
      "--name",
      options.name,
      "--policies",
      JSON.stringify(policies),
    ),
  ) as { id?: unknown; value?: unknown };
  if (typeof created.id !== "string" || typeof created.value !== "string") {
    throw new Error("Cloudflare created a token without an id or a value");
  }
  const id = created.id;
  return {
    ...s3CredentialsOf({ id, value: created.value }),
    revoke: async () => {
      // Without --force, cf asks for confirmation; with no one to answer
      // it exits 0 and deletes nothing. So the deletion is checked too.
      await cf("accounts", "tokens", "delete", id, "--force");
      const left = result(
        await cf("accounts", "tokens", "list"),
      ) as ReadonlyArray<{
        id: string;
      }>;
      if (left.some((token) => token.id === id)) {
        throw new Error(
          `the run's token "${options.name}" is still there: delete it in the dashboard (Manage account, Account API tokens)`,
        );
      }
    },
  };
}
