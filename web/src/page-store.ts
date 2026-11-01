import * as Cookies from "effect/http/Cookies";
import { edgeCacheControlHeader } from "./cache.ts";
import { contentEncoding } from "./pages/encoding.ts";
import { themeOf } from "./pages/theme-cookie.ts";

/**
 * The Worker's store of the pages it has built, in Workers KV, in front of
 * every GET it answers, so a page is read from the database once for each
 * version of the data it shows, not once per data center every few
 * minutes. KV is read from every data center, and keeps what a data center
 * reads near it, so a visitor in one city gets the page a visitor in
 * another had built.
 *
 * - **What a page is a function of:** the build (its templates, styles and
 *   code, `build`), the version of the public data (core's
 *   src/site-version.ts: a digest of every row the site reads), the time
 *   window it falls in (between two of the data's boundaries, each
 *   published evening's start and end, and the year in San Francisco, which
 *   an event's card prints), the mode the visitor's cookie fixes, and its
 *   URL. A page is kept under exactly those, so a kept page is right for as
 *   long as it can be found: nothing expires by time, and nothing is purged.
 * - **The site's version** is kept in the same namespace, under
 *   {@link siteKey}, and read at most every {@link siteTtl} seconds. It is
 *   checked against the database at most every {@link checkEvery}
 *   milliseconds, after a response, by whichever request finds it old. A
 *   new version is used from {@link SitePointer.next}'s `from`: once
 *   Hyperdrive can no longer answer with a read older than the change
 *   (reader-caching.ts), so no page of the new version is built from the
 *   old data. Until then, the version before it is served.
 * - What may be kept is what the Cache-Control of the response says may be
 *   kept by a shared cache (`public`, with `s-maxage`): 200 and 404, without
 *   a cookie set. A page in a mode the visitor fixed is sent `private` and
 *   names its public lifetimes in `x-edge-cache-control`; it is kept by
 *   that mode. Anything else (failures, `no-store`, redirects that set a
 *   cookie) is never kept.
 * - The body is kept as the page built it, uncompressed, and compressed for
 *   each visitor as it is served (see response.ts).
 * - Photo variants keep their own cache under their own URLs and pass
 *   through untouched (see {@link ownCachePrefixes}).
 *
 * Every answer says how it was served in `Server-Timing`:
 * `store;desc="hit"|"miss"|"bypass"` with how long reading the store took.
 */

/** The part of a KV namespace the store uses. */
export interface PageNamespace {
  get(
    key: string,
    options: { readonly type: "arrayBuffer"; readonly cacheTtl?: number },
  ): Promise<ArrayBuffer | null>;
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { readonly expirationTtl?: number },
  ): Promise<void>;
}

/** The part of the execution context the store uses. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** A version of the public data (core's src/site-version.ts). */
export interface SiteState {
  readonly version: string;
  /** Epoch milliseconds at which a page may change with no write, ascending. */
  readonly boundaries: ReadonlyArray<number>;
}

/**
 * What the namespace says about the site's data: the version pages are
 * built from now, and the one they will be built from once it is safe to.
 */
export interface SitePointer {
  /** When the database was last asked, in epoch milliseconds. */
  readonly checkedAt: number;
  readonly current?: SiteState;
  /** A newer version, used from `from` on (epoch milliseconds). */
  readonly next?: SiteState & { readonly from: number };
}

/** Where the namespace keeps the {@link SitePointer}. */
export const siteKey = "site";

/** Seconds a data center keeps the pointer, KV's least. */
export const siteTtl = 30;

/**
 * How often the database is asked whether the data changed, at most, while
 * the site is visited: within the five minutes pages were kept for before
 * the store.
 */
export const checkEvery = 5 * 60 * 1000;

/** Seconds a data center keeps a page it has read: kept pages never change. */
export const pageTtl = 24 * 60 * 60;

/**
 * Seconds a page is kept at all: a version the data has moved on from goes
 * with it, and a page still asked for is built again.
 */
export const keepFor = 30 * 24 * 60 * 60;

/**
 * Paths with a cache of their own, which this store leaves alone: photo
 * variants (images/route.ts) are kept in the Cache API under their own
 * URLs, and stream originals too large to hold.
 */
export const ownCachePrefixes: ReadonlyArray<string> = ["/img/"];

/** The version in use at `at`: the next one once it may be, else the current. */
export function effectiveState(
  pointer: SitePointer,
  at: number,
): SiteState | undefined {
  return pointer.next !== undefined && at >= pointer.next.from
    ? pointer.next
    : pointer.current;
}

/**
 * The pointer after asking the database at `at`, which answered `state`.
 * A version that is new is used only after `turnover` milliseconds; one
 * already in use, or already waiting, stays as it is.
 */
export function nextPointer(
  known: SitePointer | undefined,
  state: SiteState,
  at: number,
  turnover: number,
): SitePointer {
  const effective = known === undefined ? undefined : effectiveState(known, at);
  const inUse: SiteState | undefined =
    effective === undefined
      ? undefined
      : { version: effective.version, boundaries: effective.boundaries };
  if (inUse?.version === state.version) {
    return { checkedAt: at, current: inUse };
  }
  if (known?.next?.version === state.version) {
    return { ...known, checkedAt: at };
  }
  return {
    checkedAt: at,
    ...(inUse === undefined ? {} : { current: inUse }),
    next: { ...state, from: at + turnover },
  };
}

const isState = (value: unknown): value is SiteState =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "version") === "string" &&
  Array.isArray(Reflect.get(value, "boundaries")) &&
  (Reflect.get(value, "boundaries") as Array<unknown>).every(
    (boundary) => typeof boundary === "number" && Number.isFinite(boundary),
  );

/** The pointer the namespace holds, or undefined for anything else. */
export function parsePointer(text: string): SitePointer | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const checkedAt: unknown = Reflect.get(value, "checkedAt");
  const current: unknown = Reflect.get(value, "current");
  const next: unknown = Reflect.get(value, "next");
  if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) {
    return undefined;
  }
  if (current !== undefined && !isState(current)) return undefined;
  if (
    next !== undefined &&
    !(isState(next) && typeof Reflect.get(next, "from") === "number")
  ) {
    return undefined;
  }
  return value as SitePointer;
}

/** The instant pages read the data as of: the start of its minute (core's src/clock.ts). */
const minuteOf = (at: number) => Math.floor(at / 60_000) * 60_000;

/**
 * The time window `at` falls in, by the minute pages read the data as of:
 * how many of `boundaries` it has passed, and the year in San Francisco
 * (Pacific Standard Time every New Year's Eve). Two instants in the same
 * window build the same page from the same data.
 */
export function windowAt(boundaries: ReadonlyArray<number>, at: number) {
  const minute = minuteOf(at);
  const passed = boundaries.filter((boundary) => boundary <= minute).length;
  const year = new Date(minute - 8 * 60 * 60 * 1000).getUTCFullYear();
  return `${passed}.${year}`;
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * The key a request's page is kept under: the build, the data's version and
 * time window, the visitor's mode (the `theme` cookie, read as the page
 * reads it, or "system") and a digest of its URL, so any URL fits KV's
 * 512-byte keys.
 */
export async function pageKey(
  request: Request,
  build: string,
  state: SiteState,
  at: number,
): Promise<string> {
  const url = new URL(request.url);
  const mode =
    themeOf(Cookies.parseHeader(request.headers.get("cookie") ?? "")) ??
    "system";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${url.origin}${url.pathname}${url.search}`),
  );
  return `page/${build}/${state.version}/${windowAt(state.boundaries, at)}/${mode}/${hex(digest)}`;
}

/** Whether `cacheControl` lets a shared cache keep the response. */
export function shareable(cacheControl: string | null): boolean {
  if (cacheControl === null) return false;
  const words = cacheControl
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().split("=")[0] ?? "");
  if (!words.includes("public")) return false;
  if (words.some((word) => ["private", "no-store", "no-cache"].includes(word)))
    return false;
  const fresh = /(?:^|,)\s*s-maxage\s*=\s*(\d+)\s*(?:,|$)/i.exec(
    cacheControl,
  )?.[1];
  return fresh !== undefined && Number(fresh) > 0;
}

/** Whether `response` may be kept (see the module's comment). */
export const keepable = (response: Response): boolean =>
  (response.status === 200 || response.status === 404) &&
  !response.headers.has("set-cookie") &&
  shareable(
    response.headers.get(edgeCacheControlHeader) ??
      response.headers.get("cache-control"),
  );

/** Headers a response carries for the store alone, never sent on. */
const internalHeaders = [edgeCacheControlHeader] as const;

/** `response` without the headers the store keeps for itself. */
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

/** `response` with `name;desc=...;dur=...` added to its Server-Timing. */
function withTiming(
  response: Response,
  description: "hit" | "miss" | "bypass",
  duration: number,
): Response {
  const headers = new Headers(response.headers);
  const entry = `store;desc="${description}";dur=${Math.max(0, duration).toFixed(1)}`;
  const timing = headers.get("server-timing");
  headers.set("server-timing", timing === null ? entry : `${entry}, ${timing}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** What a kept page holds beside its body. */
interface Kept {
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  /** The page is compressed for each visitor as it is served. */
  readonly encode: boolean;
}

/**
 * The bytes a page is kept as: the length of its description, the
 * description (status and headers, without the request's timings, the
 * coding its builder took, or the store's own headers), then its body.
 */
export async function keptBytes(response: Response): Promise<ArrayBuffer> {
  const headers = [...response.headers].filter(
    ([name]) =>
      !["content-encoding", "server-timing", ...internalHeaders].includes(
        name.toLowerCase(),
      ),
  );
  const kept: Kept = {
    status: response.status,
    headers,
    encode: (response.headers.get("content-type") ?? "").startsWith(
      "text/html",
    ),
  };
  const head = new TextEncoder().encode(JSON.stringify(kept));
  const body = new Uint8Array(await response.arrayBuffer());
  const bytes = new Uint8Array(4 + head.length + body.length);
  new DataView(bytes.buffer).setUint32(0, head.length);
  bytes.set(head, 4);
  bytes.set(body, 4 + head.length);
  return bytes.buffer;
}

/** A kept page as `request`'s visitor gets it, or undefined if it can't be read. */
export function servedFrom(
  bytes: ArrayBuffer,
  request: Request,
): Response | undefined {
  try {
    const length = new DataView(bytes).getUint32(0);
    const kept = JSON.parse(
      new TextDecoder().decode(new Uint8Array(bytes, 4, length)),
    ) as Kept;
    const headers = new Headers(kept.headers as Array<[string, string]>);
    if (kept.encode) {
      const coding = contentEncoding(
        request.headers.get("accept-encoding") ?? undefined,
      );
      if (coding !== undefined && coding !== "identity") {
        headers.set("content-encoding", coding);
      }
    }
    return new Response(bytes.slice(4 + length), {
      status: kept.status,
      headers,
    });
  } catch {
    return undefined;
  }
}

export interface PageStoreOptions {
  readonly pages: PageNamespace;
  /**
   * The build's content hash (see scripts/build.ts): a deploy that changes
   * what pages are made of never serves another build's.
   */
  readonly build: string;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  /** The data's version, read from the database. */
  readonly siteState: () => Promise<SiteState>;
  /**
   * Milliseconds after a change before pages are built from it: how long
   * the database's cache in front of the Worker may answer with an older
   * read (reader-caching.ts), none without one.
   */
  readonly turnover: number;
}

/**
 * `handle` behind the store. Only GET requests are looked up; the rest,
 * paths with their own cache, a client refusing every coding, and anything
 * the store can't reach go straight to `handle`.
 */
export function pageStored(
  handle: (request: Request, context: WaitUntil) => Promise<Response>,
  { pages, build, now, siteState, turnover }: PageStoreOptions,
): (request: Request, context: WaitUntil) => Promise<Response> {
  /** The pointer as this isolate last read it, and when. */
  let known:
    | { readonly pointer?: SitePointer; readonly at: number }
    | undefined;
  /** Whether this isolate is asking the database already. */
  let checking = false;

  const readPointer = async (): Promise<SitePointer | undefined> => {
    if (known !== undefined && now() - known.at < siteTtl * 1000) {
      return known.pointer;
    }
    const bytes = await pages
      .get(siteKey, { type: "arrayBuffer", cacheTtl: siteTtl })
      .catch(() => null);
    const pointer =
      bytes === null
        ? undefined
        : parsePointer(new TextDecoder().decode(bytes));
    known = { ...(pointer === undefined ? {} : { pointer }), at: now() };
    return pointer;
  };

  /** Asks the database, and records what it said; never fails. */
  const check = async (pointer: SitePointer | undefined) => {
    if (checking) return;
    checking = true;
    try {
      const state = await siteState();
      const at = now();
      const next = nextPointer(pointer, state, at, turnover);
      await pages.put(siteKey, JSON.stringify(next));
      known = { pointer: next, at };
    } catch {
      // The next request that finds the pointer old asks again.
    } finally {
      checking = false;
    }
  };

  return async (request, context) => {
    const { pathname } = new URL(request.url);
    if (ownCachePrefixes.some((prefix) => pathname.startsWith(prefix))) {
      return handle(request, context);
    }
    const acceptEncoding = request.headers.get("accept-encoding") ?? undefined;
    const bypass = async () =>
      withTiming(
        withoutInternalHeaders(await handle(request, context)),
        "bypass",
        0,
      );
    // A client refusing every coding gets the page's own answer (406).
    if (
      request.method !== "GET" ||
      contentEncoding(acceptEncoding) === undefined
    ) {
      return bypass();
    }

    const started = now();
    const pointer = await readPointer();
    if (pointer === undefined || now() - pointer.checkedAt >= checkEvery) {
      context.waitUntil(check(pointer));
    }
    const at = now();
    const state =
      pointer === undefined ? undefined : effectiveState(pointer, at);
    if (state === undefined) return bypass();

    const key = await pageKey(request, build, state, at);
    const bytes = await pages
      .get(key, { type: "arrayBuffer", cacheTtl: pageTtl })
      .catch(() => null);
    const lookup = now() - started;
    const kept = bytes === null ? undefined : servedFrom(bytes, request);
    if (kept !== undefined) return withTiming(kept, "hit", lookup);

    const response = await handle(request, context);
    // Kept only if it was built in the window and version it is kept
    // under: a build that ran past a boundary may show the next one.
    const built = now();
    if (
      keepable(response) &&
      effectiveState(pointer ?? { checkedAt: 0 }, built)?.version ===
        state.version &&
      windowAt(state.boundaries, built) === windowAt(state.boundaries, at)
    ) {
      // The copy is taken before the response's body goes to the visitor.
      const copy = new Response(response.clone().body, response);
      context.waitUntil(
        keptBytes(copy)
          .then((value) => pages.put(key, value, { expirationTtl: keepFor }))
          .catch(() => undefined),
      );
    }
    return withTiming(withoutInternalHeaders(response), "miss", lookup);
  };
}
