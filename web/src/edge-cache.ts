import { edgeCacheControlHeader } from "./cache.ts";
import { contentEncoding } from "./pages/response.ts";
import { themeOf } from "./pages/theme.ts";

/**
 * The Worker's own cache in front of every GET it answers, so a warm page
 * never waits on the database. Responses on workers.dev, and those a Worker
 * builds itself, never reach Cloudflare's CDN cache, so the Worker keeps
 * them in the data center's cache with the Cache API (`caches.default`).
 *
 * - What may be kept, and for how long, comes from the response itself: a
 *   `public` Cache-Control with `s-maxage` (how long a copy is fresh) and
 *   `stale-while-revalidate` (how long after that it may still be served
 *   while a fresh one is built). A page in a mode the visitor fixed is sent
 *   `private`, so no shared cache downstream mixes modes up; it names the
 *   public lifetimes it would have had in `x-edge-cache-control`, because
 *   this cache keys it by that mode (see `edgeKey`). Anything else
 *   (`private`, `no-store`, failures, redirects that set a cookie) is never
 *   kept.
 * - The Cache API doesn't serve stale copies itself, so the Worker does:
 *   a copy past its freshness but within its stale window is served at
 *   once, and the page is built again after the response, with
 *   `ctx.waitUntil`. One isolate rebuilds a page at most once at a time.
 * - Copies are kept compressed by nobody: the body is stored as is, and
 *   each visitor's coding is chosen as the page is served (see
 *   response.ts), so a client that refuses Brotli never gets it.
 * - The purge story: everything is short. Data pages are fresh for a
 *   minute and served stale for at most an hour while they refresh, which
 *   is within the hour the Luma sync runs on; not found is kept a minute,
 *   never stale. Every deploy starts from an empty cache: the key carries
 *   the build's content hash, so a page never outlives the stylesheet and
 *   templates it was built with.
 *
 * Every answer says how it was served in `Server-Timing`, as photo variants
 * say theirs (`img;desc=...`): `cache;desc="hit"|"stale"|"miss"|"bypass"`
 * with the lookup's duration. Photo variants keep their own cache, under
 * their own URLs, and pass through untouched (see `ownCachePrefixes`).
 */

/** How long a kept copy is fresh, and how long after that it may be served stale. */
export interface EdgePolicy {
  /** Seconds a copy is fresh. */
  readonly fresh: number;
  /** Seconds after that it may still be served while it is rebuilt. */
  readonly stale: number;
}

/** Headers the stored copy carries about itself, never sent on. */
const storedAtHeader = "x-edge-stored-at";
const freshHeader = "x-edge-fresh";
const staleHeader = "x-edge-stale";
/** The page was compressed for its visitor, so it is again on the way out. */
const encodeHeader = "x-edge-encode";
/** What visitors were told, while the stored copy says how long to keep it. */
const originalHeader = "x-edge-original-cache-control";
const internalHeaders = [
  edgeCacheControlHeader,
  originalHeader,
  storedAtHeader,
  freshHeader,
  staleHeader,
  encodeHeader,
] as const;

const directive = (cacheControl: string, name: string): number | undefined => {
  const match = new RegExp(
    `(?:^|,)\\s*${name}\\s*=\\s*(\\d+)\\s*(?:,|$)`,
    "i",
  ).exec(cacheControl)?.[1];
  return match === undefined ? undefined : Number(match);
};

/**
 * The policy a response's Cache-Control (or its `x-edge-cache-control`)
 * keeps it by, or undefined when it must not be kept: only `public`
 * responses with an `s-maxage`, and never `no-store`, `no-cache` or
 * `private` ones.
 */
export function edgePolicy(
  cacheControl: string | null,
): EdgePolicy | undefined {
  if (cacheControl === null) return undefined;
  const words = cacheControl
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().split("=")[0] ?? "");
  if (!words.includes("public")) return undefined;
  if (words.some((word) => ["private", "no-store", "no-cache"].includes(word)))
    return undefined;
  const fresh = directive(cacheControl, "s-maxage");
  if (fresh === undefined || fresh <= 0) return undefined;
  return {
    fresh,
    stale: directive(cacheControl, "stale-while-revalidate") ?? 0,
  };
}

/** Whether a copy `age` seconds old is fresh, may be served stale, or is too old. */
export type Freshness = "fresh" | "stale" | "expired";

export function freshness(age: number, policy: EdgePolicy): Freshness {
  if (age < policy.fresh) return "fresh";
  if (age < policy.fresh + policy.stale) return "stale";
  return "expired";
}

/**
 * The key a request's copy is kept under: its URL (host, path and query)
 * under the build's hash, and the mode the visitor's `theme` cookie fixes,
 * or "system" without one. Pages are a function of exactly these (an
 * event's own mode follows from its URL), so no visitor ever gets another
 * mode's copy, and no deploy serves an older build's.
 */
export function edgeKey(request: Request, build: string): string {
  const url = new URL(request.url);
  const mode = themeOf(cookiesOf(request.headers.get("cookie"))) ?? "system";
  return `${url.origin}/__edge/${build}/${mode}${url.pathname}${url.search}`;
}

/** The cookies a Cookie header names, the first of each name winning. */
function cookiesOf(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    const name = pair.slice(0, at).trim();
    if (name !== "" && !(name in cookies)) {
      cookies[name] = pair.slice(at + 1).trim();
    }
  }
  return cookies;
}

/** The part of the Cache API this cache uses. */
export interface ResponseCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/** The part of the execution context this cache uses. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export interface EdgeCacheOptions {
  readonly cache: ResponseCache;
  /**
   * What the key starts with: the build's content hash (see
   * scripts/build.ts), and the deployment's own name for its cache.
   */
  readonly build: string;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
}

/** `response` with `name;desc=...;dur=...` added to its Server-Timing. */
function withTiming(
  response: Response,
  name: string,
  description: string,
  duration: number,
): Response {
  const headers = new Headers(response.headers);
  const entry = `${name};desc="${description}";dur=${Math.max(0, duration).toFixed(1)}`;
  const timing = headers.get("server-timing");
  headers.set("server-timing", timing === null ? entry : `${entry}, ${timing}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** `response` without the headers this cache keeps for itself. */
function withoutInternalHeaders(response: Response): Response {
  if (!internalHeaders.some((name) => response.headers.has(name))) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const name of internalHeaders) headers.delete(name);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The copy of `response` to keep under `policy`: its body as is (the
 * runtime compresses on the way out, so its Content-Encoding goes), its
 * headers but the timings of the request that built it, and when it was
 * stored. It is kept for its whole fresh and stale window.
 */
function storable(
  response: Response,
  policy: EdgePolicy,
  now: number,
): Response {
  const headers = new Headers(response.headers);
  // A page is compressed for each visitor as it is served; whatever coding
  // the visitor who built it took, the copy is the page itself.
  if ((headers.get("content-type") ?? "").startsWith("text/html")) {
    headers.set(encodeHeader, "1");
  }
  headers.delete("content-encoding");
  headers.delete("server-timing");
  headers.delete(edgeCacheControlHeader);
  headers.set(storedAtHeader, String(now));
  headers.set(freshHeader, String(policy.fresh));
  headers.set(staleHeader, String(policy.stale));
  // What the data center's cache keeps it by; what visitors are told is in
  // the headers they get (served copies keep the original Cache-Control).
  headers.set(originalHeader, headers.get("cache-control") ?? "");
  headers.set(
    "cache-control",
    `public, max-age=${policy.fresh + policy.stale}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A kept copy as `request`'s visitor gets it. */
function served(copy: Response, request: Request): Response {
  const headers = new Headers(copy.headers);
  const original = headers.get(originalHeader);
  if (original !== null) headers.set("cache-control", original);
  const encode = headers.get(encodeHeader) === "1";
  for (const name of internalHeaders) headers.delete(name);
  if (encode) {
    const coding = contentEncoding(
      request.headers.get("accept-encoding") ?? undefined,
    );
    if (coding !== undefined && coding !== "identity") {
      headers.set("content-encoding", coding);
    }
  }
  return new Response(copy.body, {
    status: copy.status,
    statusText: copy.statusText,
    headers,
  });
}

/** How old a kept copy is, in seconds, and the policy it was kept by. */
function aged(
  copy: Response,
  now: number,
): { readonly age: number; readonly policy: EdgePolicy } | undefined {
  const storedAt = Number(copy.headers.get(storedAtHeader));
  const fresh = Number(copy.headers.get(freshHeader));
  const stale = Number(copy.headers.get(staleHeader));
  if (![storedAt, fresh, stale].every(Number.isFinite)) return undefined;
  return { age: (now - storedAt) / 1000, policy: { fresh, stale } };
}

/**
 * Paths with a cache of their own, which this one leaves alone: photo
 * variants (images/route.ts) are kept in the same Cache API under their
 * own URLs, and stream originals too large to hold.
 */
export const ownCachePrefixes: ReadonlyArray<string> = ["/img/"];

/**
 * `handle` behind the cache. Only GET requests are looked up; the rest,
 * paths with their own cache, and anything the cache can't reach go
 * straight to `handle`, which gets the request's context as it would.
 */
export function edgeCached(
  handle: (request: Request, context: WaitUntil) => Promise<Response>,
  { cache, build, now }: EdgeCacheOptions,
): (request: Request, context: WaitUntil) => Promise<Response> {
  /** Keys this isolate is rebuilding, so a burst rebuilds once. */
  const rebuilding = new Set<string>();

  /** Builds the page and keeps it, if it may be kept. */
  const rebuild = async (request: Request, key: string, context: WaitUntil) => {
    const response = await handle(request, context);
    const policy = edgePolicy(
      response.headers.get(edgeCacheControlHeader) ??
        response.headers.get("cache-control"),
    );
    const keep =
      policy !== undefined &&
      (response.status === 200 || response.status === 404) &&
      !response.headers.has("set-cookie");
    // The copy is taken before the response's body goes to the visitor.
    const store = keep
      ? cache
          .put(
            new Request(key),
            storable(
              new Response(response.clone().body, response),
              policy,
              now(),
            ),
          )
          .catch(() => undefined)
      : undefined;
    return { response: withoutInternalHeaders(response), store };
  };

  return async (request, context) => {
    // A client refusing every coding gets the page's own answer (406).
    const acceptEncoding = request.headers.get("accept-encoding") ?? undefined;
    const { pathname } = new URL(request.url);
    if (ownCachePrefixes.some((prefix) => pathname.startsWith(prefix))) {
      return handle(request, context);
    }
    if (
      request.method !== "GET" ||
      contentEncoding(acceptEncoding) === undefined
    ) {
      return withTiming(
        withoutInternalHeaders(await handle(request, context)),
        "cache",
        "bypass",
        0,
      );
    }
    const key = edgeKey(request, build);
    const started = now();
    const copy = await cache.match(new Request(key)).catch(() => undefined);
    const lookup = now() - started;
    const state = copy === undefined ? undefined : aged(copy, now());
    if (copy !== undefined && state !== undefined) {
      const kind = freshness(state.age, state.policy);
      if (kind === "fresh") {
        return withTiming(served(copy, request), "cache", "hit", lookup);
      }
      if (kind === "stale") {
        if (!rebuilding.has(key)) {
          rebuilding.add(key);
          context.waitUntil(
            // A GET has no body, so its URL and headers are the whole request.
            rebuild(
              new Request(request.url, { headers: request.headers }),
              key,
              context,
            )
              .then(({ response, store }) =>
                Promise.all([response.body?.cancel(), store]),
              )
              .catch(() => undefined)
              .finally(() => rebuilding.delete(key)),
          );
        }
        return withTiming(served(copy, request), "cache", "stale", lookup);
      }
    }
    const { response, store } = await rebuild(request, key, context);
    if (store !== undefined) context.waitUntil(store);
    return withTiming(response, "cache", "miss", lookup);
  };
}

/** The data center's cache, where the runtime has one. */
export function dataCenterCache(): ResponseCache | undefined {
  const storage: unknown = Reflect.get(globalThis, "caches");
  if (typeof storage !== "object" || storage === null) return undefined;
  const cache: unknown = Reflect.get(storage, "default");
  return isResponseCache(cache) ? cache : undefined;
}

const isResponseCache = (value: unknown): value is ResponseCache =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "match") === "function" &&
  typeof Reflect.get(value, "put") === "function";
