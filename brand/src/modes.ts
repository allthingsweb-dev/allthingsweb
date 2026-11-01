/**
 * The brand's two modes and how a page names each, on their own: a module
 * that reads no tokens, so code that only needs to tell the modes apart
 * (the Worker's cache key, web/src/edge-cache.ts) doesn't validate the
 * token file on a cold start. tokens.ts and css.ts export them too.
 */

/** The two modes: Paper is light, Night is dark. */
export const modes = ["paper", "night"] as const;
export type Mode = (typeof modes)[number];

/** The `data-theme` value of each mode. */
export const dataTheme = {
  paper: "light",
  night: "dark",
} as const satisfies Record<Mode, string>;
