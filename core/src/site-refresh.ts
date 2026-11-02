import { Config, Console, Effect, Layer, Option, Redacted } from "effect";
import { refreshPath } from "./refresh-path.ts";

/**
 * Telling allthings.dev that a command may have changed its data. The site
 * keeps each page by a digest of the data (web/src/page-store.ts) and
 * checks it only hourly on its own; a command that tells it has its change
 * shown within about two minutes (web/src/refresh.ts). Every core script
 * that connects through `Database.scriptLayer` tells it when it ends,
 * whether or not it wrote: the site compares the digest itself, and a read
 * costs it one query.
 *
 * - `SITE_REFRESH_TOKEN` (1Password "allthings site refresh") is the
 *   site's word for it. A command connected to Neon that isn't given it
 *   reads it from the vault itself (`op read`, signed in as the caller is),
 *   so no brief has to export it; when neither has it, nothing is sent and
 *   the command says so on stderr, since its change then waits for the
 *   hour. A command elsewhere (a test, a local database) sends nothing.
 * - `SITE_ORIGIN` names another site (a test's); allthings.dev otherwise.
 *
 * It never fails the command, and prints only to stderr, never the token.
 */

/** The site the studio tells. */
export const siteOrigin = "https://allthings.dev";

/** How long the site has to answer, in milliseconds. */
export const tellDeadline = 15_000;

/**
 * Where to send the word: the refresh path on `origin`, if it is https,
 * or http on this machine alone (a test's), so the token never crosses a
 * network in the clear. Undefined for anything else.
 */
export const refreshUrl = (origin: string): URL | undefined => {
  const url = URL.parse(refreshPath, origin);
  if (url === null) return undefined;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return url.protocol === "https:" || (url.protocol === "http:" && local)
    ? url
    : undefined;
};

/** Where the vault keeps the site's token (infra/scripts/site-refresh-token.ts). */
export const refreshTokenReference =
  "op://allthings/allthings site refresh/credential";

/** How long `op read` may take, in milliseconds. */
const vaultDeadline = 15_000;

/**
 * A vault item's value through the 1Password CLI, signed in as the caller
 * is (OP_SERVICE_ACCOUNT_TOKEN, or the desktop app): undefined when `op`
 * isn't there, fails, or takes too long. Its value never prints.
 */
export async function opRead(reference: string): Promise<string | undefined> {
  const bun = (globalThis as { Bun?: typeof Bun }).Bun;
  if (bun === undefined) return undefined;
  try {
    const child = bun.spawn(["op", "read", "--no-newline", reference], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: vaultDeadline,
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

/** Whether `url` is a connection to Neon, where production lives. */
const isNeon = (url: string): boolean => {
  const host = URL.parse(url)?.hostname ?? "";
  return host === "neon.tech" || host.endsWith(".neon.tech");
};

/** Tells the site; what happened goes to stderr. Never fails. */
export const tellSite = (
  fetch: typeof globalThis.fetch = globalThis.fetch,
  readVault: (reference: string) => Promise<string | undefined> = opRead,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const origin = yield* Config.String("SITE_ORIGIN").pipe(
      Config.withDefault(siteOrigin),
    );
    const database = yield* Config.option(Config.Redacted("DATABASE_URL"));
    const onNeon =
      Option.isSome(database) && isNeon(Redacted.value(database.value));
    const given = yield* Config.option(Config.Redacted("SITE_REFRESH_TOKEN"));
    // The environment's token, or, for a command on Neon (production),
    // the vault's: no brief has to remember to export it.
    const secret =
      Option.isSome(given) && Redacted.value(given.value).trim() !== ""
        ? Redacted.value(given.value)
        : onNeon
          ? yield* Effect.promise(() =>
              readVault(refreshTokenReference).catch(() => undefined),
            )
          : undefined;
    if (secret === undefined || secret.trim() === "") {
      if (onNeon) {
        yield* Console.error(
          `${origin} wasn't told (no SITE_REFRESH_TOKEN, and 1Password didn't give it): a change shows within the hour.`,
        );
      }
      return;
    }
    const url = refreshUrl(origin);
    if (url === undefined) {
      yield* Console.error(
        `SITE_ORIGIN isn't an https origin, so the site wasn't told: a change shows within the hour.`,
      );
      return;
    }
    const answer = yield* Effect.tryPromise(async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(tellDeadline),
      });
      const body = (await response.json().catch(() => null)) as {
        readonly next?: { readonly from?: string } | null;
      } | null;
      return { status: response.status, body };
    });
    yield* Console.error(
      answer.status !== 200
        ? `${url.origin} didn't take the word (${answer.status}): a change shows within the hour.`
        : typeof answer.body?.next?.from === "string"
          ? `${url.origin} told: it shows the new data from ${answer.body.next.from}.`
          : `${url.origin} told: its data is current.`,
    );
  }).pipe(
    Effect.catchCause(() =>
      Console.error(
        `The site couldn't be told: a change shows within the hour.`,
      ),
    ),
  );

/** Tells the site when the scope it is built in closes: a command's end. */
export const afterwards: Layer.Layer<never> = Layer.effectDiscard(
  Effect.addFinalizer(() => tellSite()),
);
