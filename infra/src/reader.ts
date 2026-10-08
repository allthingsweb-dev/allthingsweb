import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import { SourceError } from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
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
