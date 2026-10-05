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

const invalid = (reason: string) =>
  Effect.fail(
    new Config.ConfigError(
      new SourceError({ message: `NEON_READER_URL ${reason}` }),
    ),
  );

const decoded = (component: string): string | undefined => {
  try {
    return decodeURIComponent(component);
  } catch {
    return undefined;
  }
};

/**
 * A Postgres connection string as a Hyperdrive origin. It must be for
 * {@link READER_ROLE}: whatever reads production from outside prod may only
 * read it. Query parameters such as `sslmode` are dropped, since Hyperdrive
 * always connects to the origin over TLS and verifies its certificate. Error
 * messages never include the string.
 */
export const readerOrigin = (
  connectionString: Redacted.Redacted,
): Effect.Effect<Cloudflare.Hyperdrive.PublicOrigin, Config.ConfigError> => {
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
  if (user !== READER_ROLE) {
    return invalid(`must be for the read-only "${READER_ROLE}" role`);
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
 * Production's database, read-only, from `NEON_READER_URL` in the deploy's
 * environment. A Config, not a value: Alchemy resolves it when it plans the
 * Hyperdrive that uses it, so `alchemy destroy`, which plans nothing, runs
 * without it, and a deploy without it fails before changing anything.
 */
export const Reader = Config.Redacted("NEON_READER_URL").pipe(
  Config.mapEffect(readerOrigin),
);
