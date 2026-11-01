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
