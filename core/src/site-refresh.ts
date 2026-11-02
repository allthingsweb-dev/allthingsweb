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
 *   site's word for it. Without it nothing is sent; a command connected to
 *   Neon says so on stderr, since its change then waits for the hour.
 * - `SITE_ORIGIN` names another site (a test's); allthings.dev otherwise.
 *
 * It never fails the command, and prints only to stderr, never the token.
 */

/** The site the studio tells. */
export const siteOrigin = "https://allthings.dev";

/** How long the site has to answer, in milliseconds. */
export const tellDeadline = 15_000;

/** Whether `url` is a connection to Neon, where production lives. */
const isNeon = (url: string): boolean => {
  const host = URL.parse(url)?.hostname ?? "";
  return host === "neon.tech" || host.endsWith(".neon.tech");
};

/** Tells the site; what happened goes to stderr. Never fails. */
export const tellSite = (
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const token = yield* Config.option(Config.Redacted("SITE_REFRESH_TOKEN"));
    const origin = yield* Config.String("SITE_ORIGIN").pipe(
      Config.withDefault(siteOrigin),
    );
    if (Option.isNone(token) || Redacted.value(token.value).trim() === "") {
      const database = yield* Config.option(Config.Redacted("DATABASE_URL"));
      if (Option.isSome(database) && isNeon(Redacted.value(database.value))) {
        yield* Console.error(
          `${origin} wasn't told (no SITE_REFRESH_TOKEN): a change shows within the hour.`,
        );
      }
      return;
    }
    const secret = Redacted.value(token.value);
    const answer = yield* Effect.tryPromise(async () => {
      const response = await fetch(`${origin}${refreshPath}`, {
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
        ? `${origin} didn't take the word (${answer.status}): a change shows within the hour.`
        : typeof answer.body?.next?.from === "string"
          ? `${origin} told: it shows the new data from ${answer.body.next.from}.`
          : `${origin} told: its data is current.`,
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
