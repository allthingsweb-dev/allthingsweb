/**
 * Cache-Control for public GET responses. Data changes when organizers edit
 * it or the hourly Luma sync runs, so a cached copy may be minutes old:
 * browsers keep it for a minute, shared caches for five, and a stale copy
 * may be served for an hour while it is refreshed. The Worker's own store
 * (page-store.ts) keeps a page by the version of the data it shows, not by
 * these times: for it, a `public` lifetime with `s-maxage` only says the
 * page may be kept.
 */
export const CacheControl = {
  /** A successful read of public data. */
  publicData: "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
  /**
   * A page that changes only when the Worker is deployed, such as /brand.
   * Browsers check back after five minutes, and shared caches may keep it
   * a day. The Worker's store keeps pages by the build, so a deploy that
   * changes it starts afresh.
   */
  page: "public, max-age=300, s-maxage=86400",
  /** Not found: a draft may be published at any moment, so only briefly. */
  notFound: "public, max-age=60, s-maxage=60",
  /** Failures are never stored, so a retry reaches the Worker. */
  failure: "no-store",
} as const;

/**
 * Cache-Control for a response that never changes under its URL: the
 * content-hashed static assets, and image variants, whose URLs name the
 * photo's version. A changed file or photo gets a new URL.
 */
export const immutable = "public, max-age=31536000, immutable";

export type CacheControl = (typeof CacheControl)[keyof typeof CacheControl];

/** One of the lifetimes above, by name. */
export type CacheControlName = keyof typeof CacheControl;

/**
 * The same lifetimes for one visitor's browser alone, for a page in the mode
 * that visitor fixed with the `theme` cookie (see pages/theme.ts). Pages are
 * also sent with `Vary: Cookie`, which keeps standard caches from mixing up
 * modes, but some shared caches ignore Vary (Cloudflare's honors only
 * Accept-Encoding); `private` keeps every such copy out of them, so the
 * only page a shared cache can hold is the one that follows the system.
 * The Worker's own store keeps pages by the mode (page-store.ts).
 */
export const PrivateCacheControl = {
  publicData: "private, max-age=60",
  page: "private, max-age=300",
  notFound: "private, max-age=60",
  failure: "no-store",
} as const satisfies Record<CacheControlName, string>;

/**
 * The header a response names the public lifetimes in that the Worker's
 * own cache keeps it by, when they differ from what visitors are told: a
 * page in a fixed mode is sent `private`, but the Worker's cache keys it by
 * that mode (see page-store.ts). It never leaves the Worker.
 */
export const edgeCacheControlHeader = "x-edge-cache-control";

/**
 * A response that sets one visitor's preference, such as their mode: never
 * stored, so every choice reaches the Worker.
 */
export const preferenceCacheControl = "no-store";
