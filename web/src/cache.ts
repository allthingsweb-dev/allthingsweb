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

/**
 * The header Workers Cache reads first (infra/src/web.ts turns the cache
 * on). Cloudflare consumes it and strips it from what visitors get, so it
 * sets the edge's lifetime alone, apart from `Cache-Control`'s.
 */
export const workersCacheHeader = "cloudflare-cdn-cache-control";

/**
 * How long Cloudflare answers a public page or read from Workers Cache
 * before the Worker starts: 30 seconds fresh, then 30 more served while one
 * request refreshes it in the background.
 *
 * Workers Cache keys a response by its path and query and the Worker's
 * version, not by the version of the data it shows, as the page store
 * does. So nothing that can change with the data may outlive this at the
 * edge: an organizer's edit or a sync run reaches visitors at most a minute
 * after the page store has it. `s-maxage` would turn stale serving off, so
 * it isn't used here.
 *
 * When the Worker fails while refreshing an expired copy (it throws, times
 * out or answers 5xx), Cloudflare serves the copy it has, without
 * `stale-if-error` for as long as it is kept. An hour bounds that: a page
 * an hour old beats an error while the Worker is down, as browsers are told
 * for public data too (`stale-while-revalidate=3600`), and after it the
 * failure reaches visitors and is seen.
 */
export const workersCacheLifetime =
  "max-age=30, stale-while-revalidate=30, stale-if-error=3600";

/**
 * `response` as Workers Cache may keep it, for `request`. A GET or HEAD
 * response that a shared cache may keep (`public` with `s-maxage`) gets
 * {@link workersCacheLifetime}, unless it is {@link immutable} (its URL
 * names its version, so a year is right). Everything else is `no-store` at
 * the edge, so nothing is kept by a rule no one wrote, such as heuristic
 * freshness: a page in the mode a visitor's cookie fixes (`private`),
 * failures, and answers that set a cookie. Requests with any other method
 * never reach Workers Cache, and pass untouched.
 */
export function forWorkersCache(
  request: Request,
  response: Response,
): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (cacheControl === immutable) return response;
  const directives = cacheControl
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim().split("=")[0]);
  const shared =
    directives.includes("public") &&
    directives.includes("s-maxage") &&
    !response.headers.has("set-cookie");
  const kept = new Response(response.body, response);
  if (shared) kept.headers.set("cache-tag", siteDataTag);
  kept.headers.set(
    workersCacheHeader,
    shared ? workersCacheLifetime : "no-store",
  );
  return kept;
}

/**
 * The `Cache-Tag` every answer Workers Cache keeps for the short edge
 * lifetime carries: the answers that can change with the data. Immutable
 * ones (assets, photo variants) don't, so a purge of it leaves them kept.
 */
export const siteDataTag = "site-data";

/** What the Worker uses of Workers Cache's runtime API (`ctx.cache`). */
export interface WorkersCachePurge {
  purge(options: { readonly tags: ReadonlyArray<string> }): Promise<{
    readonly success: boolean;
    readonly errors?: ReadonlyArray<{ readonly message?: string }>;
  }>;
}

/** How a purge of {@link siteDataTag} went, for the writer's report. */
export type EdgePurge = "purged" | "unavailable" | "failed";

/**
 * Drops every answer tagged {@link siteDataTag} from Workers Cache, so the
 * next visitor gets the page store's current page at once rather than within
 * {@link workersCacheLifetime}. "unavailable" where the runtime has no
 * Workers Cache (tests, a Worker without it); never throws.
 */
export async function purgeSiteData(
  cache: WorkersCachePurge | undefined,
): Promise<EdgePurge> {
  if (cache === undefined) return "unavailable";
  try {
    const result = await cache.purge({ tags: [siteDataTag] });
    return result.success ? "purged" : "failed";
  } catch {
    return "failed";
  }
}
