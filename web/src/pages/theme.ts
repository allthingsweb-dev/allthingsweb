import { dataTheme } from "allthings-brand/src/css.ts";
import type { Mode } from "allthings-brand/src/tokens.ts";
import { Duration } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { preferenceCacheControl } from "../cache.ts";

/**
 * The visitor's mode, without JavaScript. The header links to `?theme=`
 * on the page itself; the Worker remembers the choice in the `theme`
 * cookie and sends the visitor back (303) to the page without the query.
 * Every page then renders `data-theme` from the cookie. Without one, the
 * page follows the system through `prefers-color-scheme`.
 *
 * Because pages depend on the cookie, response.ts sends them with
 * `Vary: Cookie`, and a page in a fixed mode is cacheable by that
 * visitor's browser alone (see cache.ts), so no shared cache can hand one
 * visitor's mode to another.
 */

/** A page's mode, when the visitor fixed one; otherwise it follows the system. */
export type Theme = (typeof dataTheme)[Mode];

const themes: ReadonlyArray<Theme> = Object.values(dataTheme);

export function isTheme(value: string): value is Theme {
  return themes.some((theme) => theme === value);
}

/** What `?theme=` accepts: a fixed mode, or the system's again. */
export type Choice = Theme | "system";

export function isChoice(value: string): value is Choice {
  return value === "system" || isTheme(value);
}

/**
 * The header's choices, in its order, as the brand names them: the
 * system's mode first, since it is the default.
 */
export const choices: ReadonlyArray<{
  readonly choice: Choice;
  readonly label: string;
}> = [
  { choice: "system", label: "system" },
  { choice: dataTheme.paper, label: "paper" },
  { choice: dataTheme.night, label: "night" },
];

export const themeCookie = "theme";

/** As long as browsers keep a cookie: Chrome caps lifetimes at 400 days. */
export const themeCookieMaxAge = Duration.days(400);

const cookieOptions = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax",
} as const;

/** The mode a request's cookies fix, if any; anything unknown is no choice. */
export function themeOf(
  cookies: Readonly<Record<string, string>>,
): Theme | undefined {
  const value = cookies[themeCookie];
  return value !== undefined && isTheme(value) ? value : undefined;
}

/**
 * The answer to `?theme=<choice>` on the page at `path`, requested as
 * `url` (a path and query): remember the choice, or forget it for
 * "system", and see the page again without the `theme` parameter. The
 * page's own path is where it goes, never one read from the request, so it
 * cannot send anyone elsewhere. Never stored, so every choice reaches the
 * Worker.
 */
export function chooseTheme(
  choice: Choice,
  path: `/${string}`,
  url: string,
): HttpServerResponse.HttpServerResponse {
  // Only the query is used; the base just makes `url` parseable.
  const query = new URL(url, "http://localhost").searchParams;
  query.delete("theme");
  const search = query.size === 0 ? "" : `?${query.toString()}`;
  const redirect = HttpServerResponse.redirect(`${path}${search}`, {
    status: 303,
    headers: { "cache-control": preferenceCacheControl },
  });
  return choice === "system"
    ? HttpServerResponse.expireCookieUnsafe(
        redirect,
        themeCookie,
        cookieOptions,
      )
    : HttpServerResponse.setCookieUnsafe(redirect, themeCookie, choice, {
        ...cookieOptions,
        maxAge: themeCookieMaxAge,
      });
}
