import { dataTheme, type Mode } from "allthings-brand/src/modes.ts";

/**
 * Which mode a visitor's `theme` cookie fixes, on its own: the Worker's
 * store keeps every page by it (page-store.ts) before the app is loaded, so
 * this module reads nothing but the brand's mode names. Setting the cookie
 * is theme.ts's.
 */

/** A page's mode, when the visitor fixed one; otherwise it follows the system. */
export type Theme = (typeof dataTheme)[Mode];

const themes: ReadonlyArray<Theme> = Object.values(dataTheme);

/** Whether `value` is a mode a page can fix, as `data-theme` writes it. */
export function isTheme(value: string): value is Theme {
  return themes.some((theme) => theme === value);
}

export const themeCookie = "theme";

/** The mode a request's cookies fix, if any; anything unknown is no choice. */
export function themeOf(
  cookies: Readonly<Record<string, string>>,
): Theme | undefined {
  const value = cookies[themeCookie];
  return value !== undefined && isTheme(value) ? value : undefined;
}

/**
 * The value of the cookie `name` in a `Cookie` header, read exactly as
 * Effect's `Cookies.parseHeader` reads it (effect/http/Cookies), which the
 * app parses the same header with: pairs split at ";", keys trimmed, the
 * first of a name kept, a value starting with a quote losing its first and
 * last characters, and one with "%" decoded when it can be.
 * web/tests/theme-cookie.test.ts holds the two together on generated
 * headers. It is here so a cold start, which keys a page by its mode
 * (page-store.ts), needn't load that module and what it imports.
 */
export function cookieValue(header: string, name: string): string | undefined {
  const length = header.length;
  let position = 0;
  let terminator = 0;
  while (terminator !== length) {
    terminator = header.indexOf(";", position);
    if (terminator === -1) terminator = length;
    let equals = header.indexOf("=", position);
    // No pair is left.
    if (equals === -1) return undefined;
    // A pair without "=": skipped.
    if (equals > terminator) {
      position = terminator + 1;
      continue;
    }
    const key = header.substring(position, equals++).trim();
    if (key === name) {
      const value =
        header.charCodeAt(equals) === 0x22
          ? header.substring(equals + 1, terminator - 1).trim()
          : header.substring(equals, terminator).trim();
      if (!value.includes("%")) return value;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
    position = terminator + 1;
  }
  return undefined;
}

/** The mode a request's `Cookie` header fixes, as {@link themeOf} reads it. */
export function themeOfHeader(header: string): Theme | undefined {
  const value = cookieValue(header, themeCookie);
  return value !== undefined && isTheme(value) ? value : undefined;
}
