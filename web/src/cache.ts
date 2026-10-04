/**
 * Cache-Control for public GET responses. Data changes when organizers edit
 * it or the hourly Luma sync runs, so a cached copy may be minutes old:
 * browsers keep it for a minute, shared caches (the edge) for five, and a
 * stale copy may be served for an hour while it is refreshed. Once pages and
 * API responses are keyed by data version, versioned URLs become immutable
 * and these times only apply to the unversioned entry points.
 */
export const CacheControl = {
  /** A successful read of public data. */
  publicData: "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
  /**
   * A page that changes only when the Worker is deployed, such as /brand.
   * Browsers check back after five minutes. The edge may keep it a day:
   * Workers Cache is scoped to one deployed version, so a deploy starts
   * from an empty cache.
   */
  page: "public, max-age=300, s-maxage=86400",
  /** Not found: a draft may be published at any moment, so only briefly. */
  notFound: "public, max-age=60, s-maxage=60",
  /** Failures are never stored, so a retry reaches the Worker. */
  failure: "no-store",
} as const;

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
 * Should the Worker cache pages itself (the Cache API), its key must
 * include the mode.
 */
export const PrivateCacheControl = {
  publicData: "private, max-age=60",
  page: "private, max-age=300",
  notFound: "private, max-age=60",
  failure: "no-store",
} as const satisfies Record<CacheControlName, string>;

/**
 * A response that sets one visitor's preference, such as their mode: never
 * stored, so every choice reaches the Worker.
 */
export const preferenceCacheControl = "no-store";
