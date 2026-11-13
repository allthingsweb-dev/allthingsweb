import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import { SourceError } from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/**
 * The read-only role on production's branch, created by scripts/site-reader.ts.
 * Not Neon's "reader", which is a member of neon_superuser and can write.
 */
export const READER_ROLE = "site_reader";

/** The role the hourly sync writes as, created by scripts/site-sync.ts. */
export const SYNC_ROLE = "site_sync";

/** The role the draft preview collaborates as, created by scripts/draft-collab.ts. */
export const COLLAB_ROLE = "draft_collab";

const decoded = (component: string): string | undefined => {
  try {
    return decodeURIComponent(component);
  } catch {
    return undefined;
  }
};

/**
 * A Postgres connection string, from the variable `name`, as a Hyperdrive
 * origin. It must be for `role`, so a Hyperdrive can only ever reach
 * production as the role made for it. Query parameters such as `sslmode`
 * are dropped, since Hyperdrive always connects to the origin over TLS and
 * verifies its certificate. Error messages never include the string.
 */
export const roleOrigin =
  (name: string, role: string, description: string) =>
  (
    connectionString: Redacted.Redacted,
  ): Effect.Effect<Cloudflare.Hyperdrive.PublicOrigin, Config.ConfigError> => {
    const invalid = (reason: string) =>
      Effect.fail(
        new Config.ConfigError(
          new SourceError({ message: `${name} ${reason}` }),
        ),
      );
    const url = URL.parse(Redacted.value(connectionString));
    if (url === null) return invalid("is not a URL");
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return invalid("is not a postgres:// connection string");
    }
    const user = decoded(url.username);
    const password = decoded(url.password);
    const database = decoded(url.pathname.slice(1));
    if (url.hostname === "" || !user || !password || !database) {
      return invalid("needs a host, a user, a password and a database");
    }
    if (user !== role) {
      return invalid(`must be for the ${description} "${role}" role`);
    }
    return Effect.succeed({
      scheme: "postgres",
      host: url.hostname,
      ...(url.port === "" ? {} : { port: Number(url.port) }),
      database,
      user,
      password: Redacted.make(password),
    });
  };

/**
 * A connection string for {@link READER_ROLE} as a Hyperdrive origin:
 * whatever reads production from outside prod may only read it.
 */
export const readerOrigin = roleOrigin(
  "NEON_READER_URL",
  READER_ROLE,
  "read-only",
);

/**
 * Production's database, read-only, from `NEON_READER_URL` in the deploy's
 * environment. A Config, not a value: Alchemy resolves it when it plans the
 * Hyperdrive that uses it, so `alchemy destroy`, which plans nothing, runs
 * without it, and a deploy without it fails before changing anything.
 */
export const Reader = Config.Redacted("NEON_READER_URL").pipe(
  Config.mapEffect(readerOrigin),
);

/**
 * Production's database as {@link SYNC_ROLE}, from `NEON_SYNC_URL`, for the
 * sync Worker's Hyperdrive. Resolved like {@link Reader}.
 */
export const Writer = Config.Redacted("NEON_SYNC_URL").pipe(
  Config.mapEffect(roleOrigin("NEON_SYNC_URL", SYNC_ROLE, "sync's")),
);

/**
 * Production's database as {@link COLLAB_ROLE}, from `NEON_COLLAB_URL`, for
 * the draft preview's collaboration Hyperdrive. Resolved like {@link Reader}.
 */
export const Collaborator = Config.Redacted("NEON_COLLAB_URL").pipe(
  Config.mapEffect(roleOrigin("NEON_COLLAB_URL", COLLAB_ROLE, "collaboration")),
);

/**
 * The role the site takes talk proposals as, made by core's migration
 * 0040_proposals with a login from scripts/proposal-intake.ts.
 */
export const INTAKE_ROLE = "proposal_intake";

/**
 * A vault item's value through the 1Password CLI, signed in as the deploy
 * is (OP_SERVICE_ACCOUNT_TOKEN): undefined when `op` isn't there, fails, or
 * takes over 15 seconds. Its value never prints. Core's commands have their
 * own (core/src/site-refresh.ts); infra installs none of core's packages.
 */
export async function opRead(reference: string): Promise<string | undefined> {
  try {
    const child = Bun.spawn(["op", "read", "--no-newline", reference], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: 15_000,
    });
    const [code, value] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ]);
    return code === 0 && value.trim() !== "" ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Where the vault keeps its connection string (scripts/proposal-intake.ts). */
export const intakeReference =
  "op://allthings/allthings proposal_intake/credential";

/**
 * The intake's connection string: `NEON_INTAKE_URL` when the deploy sets
 * it, else read from 1Password with the deploy's own `op` session
 * (OP_SERVICE_ACCOUNT_TOKEN, which the prod deploy exports), as core's
 * commands read the site's refresh token: no deploy script has to learn a
 * new variable. A deploy that can read neither fails before changing
 * anything. `readVault` stands in for `op` in tests.
 */
export const intakeUrl = (
  readVault: (reference: string) => Promise<string | undefined> = opRead,
) =>
  Config.option(Config.Redacted("NEON_INTAKE_URL")).pipe(
    Config.mapEffect((given) =>
      Option.isSome(given) && Redacted.value(given.value).trim() !== ""
        ? Effect.succeed(given.value)
        : Effect.flatMap(
            Effect.promise(() => readVault(intakeReference)),
            (read) =>
              read === undefined
                ? Effect.fail(
                    new Config.ConfigError(
                      new SourceError({
                        message:
                          "NEON_INTAKE_URL is unset, and 1Password's \"allthings proposal_intake\" couldn't be read",
                      }),
                    ),
                  )
                : Effect.succeed(Redacted.make(read)),
          ),
    ),
  );

/**
 * Production's database as {@link INTAKE_ROLE}, for the site's intake
 * Hyperdrive (src/web.ts, prod only), from {@link intakeUrl}. Resolved like
 * {@link Reader}: only a deploy that declares the Hyperdrive reads it.
 */
export const Intaker = intakeUrl().pipe(
  Config.mapEffect(roleOrigin("NEON_INTAKE_URL", INTAKE_ROLE, "intake")),
);
