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
 *   path and query, whichever host it is asked on (allthings.dev, the
 *   bridge's workers.dev, a service binding's). A page is kept under exactly
 *   those, so a kept page is right for as
 *   long as it can be found: nothing expires by time, and nothing is purged.
 * - **The site's version** is kept in the same namespace, under
 *   {@link siteKey}, and read at most every {@link siteTtl} seconds. It is
 *   checked against the database when a writer says the data changed
 *   (refresh.ts: the sync after each run, the studio after each command),
 *   and otherwise at most every {@link checkEvery} milliseconds, after a
 *   response, by whichever request finds it old. A
 *   new version is used from {@link SitePointer.next}'s `from`: once
 *   Hyperdrive can no longer answer with a read older than the change
 *   (reader-caching.ts), so no page of the new version is built from the
 *   old data. Until then, the version before it is served.
 * - What may be kept is what the Cache-Control of the response says may be
 *   kept by a shared cache (`public`, with `s-maxage`): 200 and 404, without
 *   a cookie set, varying by nothing but the coding and the cookie
 *   (robots.txt varies by host, which the key leaves out). A page in a mode the visitor fixed is sent `private` and
 *   names its public lifetimes in `x-edge-cache-control`; it is kept by
 *   that mode. Anything else (failures, `no-store`, redirects that set a
 *   cookie) is never kept.
 * - **Each data center keeps copies** in its Cache API: the pointer it last
 *   read and every page it served. A visitor is answered from them at once,
 *   with no KV read; a pointer copy older than {@link siteTtl} is read
 *   again from KV after the response, and when the version moved on, this
 *   request's page under the new one is readied in the data center (from
 *   KV, or built), so a visitor sees data at most one request stale. Only a
 *   data center with no copy reads KV first.
 * - The body is kept as the page built it, uncompressed, and compressed for
 *   each visitor as it is served (see response.ts).
 * - Photo variants keep their own cache under their own URLs and pass
 *   through untouched (see {@link ownCachePrefixes}).
 *
 * Every answer says how it was served in `Server-Timing`:
 * `store;desc="hit"|"miss"|"bypass"` with how long reading the store took,
 * and for a hit where it came from: `copy;desc="local"|"kv"`.
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
 * the site is visited, when no writer has said so: the writers say so
 * themselves (refresh.ts), so this only bounds a word that was lost, or a
 * write by anything else, to the hour the sync runs on. Neon can sleep in
 * between.
 */
export const checkEvery = 60 * 60 * 1000;

/**
 * Seconds a data center keeps the answer to a page read. A kept page never
 * changes, but KV keeps a miss as long as a hit, so a data center that read
 * a page before another kept it doesn't see it for this long. It builds the
 * page itself then, and its own write is usually visible to it at once
 * (KV's "how it works"); an hour bounds the case where it isn't.
 */
export const pageTtl = 60 * 60;

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
 * reads it, or "system") and a digest of its path and query, so any URL
 * fits KV's 512-byte keys. The host is left out: pages name allthings.dev
 * and link within the host that serves them, so they are the same on
 * every host, and what isn't says so (`keepable`).
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
    new TextEncoder().encode(`${url.pathname}${url.search}`),
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

/** What a kept page may vary by: what its key and its serving account for. */
const keyedVary = new Set(["accept-encoding", "cookie"]);

/** Whether `response` may be kept (see the module's comment). */
export const keepable = (response: Response): boolean =>
  (response.status === 200 || response.status === 404) &&
  !response.headers.has("set-cookie") &&
  (response.headers.get("vary") ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .every((name) => name === "" || keyedVary.has(name)) &&
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

/**
 * `response` with where its kept page came from in its Server-Timing:
 * `copy;desc="local"` from the data center's cache, `"kv"` from KV.
 */
function withCopy(response: Response, from: "local" | "kv"): Response {
  const headers = new Headers(response.headers);
  const entry = `copy;desc="${from}"`;
  const timing = headers.get("server-timing");
  headers.set("server-timing", timing === null ? entry : `${timing}, ${entry}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * What the promise a miss hands `waitUntil` comes to: whether the page was
 * written. It never rejects, so a visitor's request never fails for it;
 * prewarm.ts reads it to count what it built.
 */
export interface Keeping {
  readonly kept: boolean;
}

/** Whether `value` is what a miss's keeping came to. */
export const isKeeping = (value: unknown): value is Keeping =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "kept") === "boolean";

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
  /**
   * The data center's cache (the Cache API), where the runtime has one: the
   * store keeps its last-known pointer and each page it served there, and
   * answers from them at once (see {@link pageStored}).
   */
  readonly local?: {
    readonly cache: DataCenterCache;
    /** Names the namespace's copies (`PAGES_ID`), so no other Worker shares them. */
    readonly id: string;
  };
}

/** The part of the Cache API (`caches.default`) the store uses. */
export interface DataCenterCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/** The data center's cache, where the runtime has one. */
export function dataCenterCache(): DataCenterCache | undefined {
  const cache: unknown = (globalThis as { caches?: { default?: unknown } })
    .caches?.default;
  return typeof cache === "object" &&
    cache !== null &&
    typeof Reflect.get(cache, "match") === "function" &&
    typeof Reflect.get(cache, "put") === "function"
    ? (cache as DataCenterCache)
    : undefined;
}

/**
 * Seconds a data center keeps its copies: a week, after which (or after
 * the cache evicts them) its next visitor reads KV again.
 */
export const localTtl = 7 * 24 * 60 * 60;

/** When a data center's copy of the pointer was read from KV (epoch ms). */
const readAtHeader = "x-store-read-at";

/**
 * Where a data center keeps the copies of the namespace `id`: under the
 * request's origin and the namespace, so Workers that share a data
 * center's cache (stages, a test's Workers) never share copies.
 */
const localKey = (request: Request, id: string, name: string) =>
  `${new URL(request.url).origin}/__store/${encodeURIComponent(id)}/${name}`;

/**
 * The pointer as the namespace holds it, read without this isolate's copy:
 * undefined when there is none, or none it can read. A failed read fails.
 */
export async function readSitePointer(
  pages: PageNamespace,
): Promise<SitePointer | undefined> {
  const bytes = await pages.get(siteKey, { type: "arrayBuffer" });
  return bytes === null
    ? undefined
    : parsePointer(new TextDecoder().decode(bytes));
}

/** What asking the database for the data's version needs. */
export type SiteCheck = Pick<
  PageStoreOptions,
  "pages" | "now" | "siteState" | "turnover"
>;

/**
 * Asks the database for the data's version now and records it, as a
 * request's check does: for whatever writes, the Sync Worker after each
 * run (refresh.ts), so a change is used once the turnover has passed
 * rather than at the next check. A failed read of the pointer fails it, and
 * nothing is written.
 */
export async function refreshSite({
  pages,
  now,
  siteState,
  turnover,
}: SiteCheck): Promise<SitePointer> {
  const known = await readSitePointer(pages);
  const next = nextPointer(known, await siteState(), now(), turnover);
  await pages.put(siteKey, JSON.stringify(next));
  return next;
}

/**
 * `handle` behind the store. Only GET requests are looked up; the rest,
 * paths with their own cache, a client refusing every coding, and anything
 * the store can't reach go straight to `handle`.
 */
export function pageStored(
  handle: (request: Request, context: WaitUntil) => Promise<Response>,
  { pages, build, now, siteState, turnover, local }: PageStoreOptions,
): (request: Request, context: WaitUntil) => Promise<Response> {
  /** The pointer as this isolate last read it, and when. */
  let known:
    | { readonly pointer?: SitePointer; readonly at: number }
    | undefined;
  /** Whether this isolate is asking the database already. */
  let checking = false;

  /** Whether this isolate is refreshing its data center's copies already. */
  let refreshing = false;

  /** Keeps `pointer`, read from KV at `at`, in this isolate and the data center. */
  const remember = (
    request: Request,
    pointer: SitePointer | undefined,
    at: number,
  ): Promise<void> => {
    known = { ...(pointer === undefined ? {} : { pointer }), at };
    if (local === undefined || pointer === undefined) return Promise.resolve();
    return local.cache
      .put(
        localKey(request, local.id, siteKey),
        new Response(JSON.stringify(pointer), {
          headers: {
            "cache-control": `public, max-age=${localTtl}`,
            [readAtHeader]: String(at),
          },
        }),
      )
      .catch(() => undefined);
  };

  /**
   * The pointer from KV, kept here and in the data center: undefined when
   * the namespace has none (or none it can read), or "unreachable" when KV
   * didn't answer, and then nothing is kept, asked or written, so one
   * failed read never replaces the pointer every isolate shares.
   */
  const fetchPointer = async (
    request: Request,
    context: WaitUntil,
  ): Promise<SitePointer | undefined | "unreachable"> => {
    let bytes: ArrayBuffer | null;
    try {
      bytes = await pages.get(siteKey, {
        type: "arrayBuffer",
        cacheTtl: siteTtl,
      });
    } catch {
      return "unreachable";
    }
    const pointer =
      bytes === null
        ? undefined
        : parsePointer(new TextDecoder().decode(bytes));
    context.waitUntil(remember(request, pointer, now()));
    return pointer;
  };

  /**
   * The pointer to answer with now: this isolate's when it is under
   * {@link siteTtl} old; else the data center's copy, however old, when
   * there is one (with `stale` set, so it is read again after the
   * response); else KV's.
   */
  const readPointer = async (
    request: Request,
    context: WaitUntil,
  ): Promise<{
    readonly pointer: SitePointer | undefined | "unreachable";
    readonly stale: boolean;
  }> => {
    if (known !== undefined && now() - known.at < siteTtl * 1000) {
      return { pointer: known.pointer, stale: false };
    }
    const copy =
      local === undefined
        ? undefined
        : await local.cache
            .match(localKey(request, local.id, siteKey))
            .catch(() => undefined);
    if (copy !== undefined) {
      const pointer = parsePointer(await copy.text().catch(() => ""));
      const readAt = Number(copy.headers.get(readAtHeader));
      if (pointer !== undefined && Number.isFinite(readAt)) {
        const fresh = now() - readAt < siteTtl * 1000;
        if (fresh) known = { pointer, at: readAt };
        return { pointer, stale: !fresh };
      }
    }
    return { pointer: await fetchPointer(request, context), stale: false };
  };

  /** Keeps a page's bytes in the data center under `key`. */
  const keepLocally = (
    request: Request,
    key: string,
    bytes: ArrayBuffer,
  ): Promise<void> =>
    local === undefined
      ? Promise.resolve()
      : local.cache
          .put(
            localKey(request, local.id, key),
            new Response(bytes, {
              headers: { "cache-control": `public, max-age=${localTtl}` },
            }),
          )
          .catch(() => undefined);

  /**
   * The page kept under `key`, and where it was found: the data center's
   * copy first, then KV's, which is then copied to the data center.
   */
  const findPage = async (
    request: Request,
    key: string,
    context: WaitUntil,
  ): Promise<
    { readonly bytes: ArrayBuffer; readonly from: "local" | "kv" } | undefined
  > => {
    const copy =
      local === undefined
        ? undefined
        : await local.cache
            .match(localKey(request, local.id, key))
            .catch(() => undefined);
    const copied =
      copy === undefined
        ? undefined
        : await copy.arrayBuffer().catch(() => undefined);
    if (copied !== undefined) return { bytes: copied, from: "local" };
    const bytes = await pages
      .get(key, { type: "arrayBuffer", cacheTtl: pageTtl })
      .catch(() => null);
    if (bytes === null) return undefined;
    context.waitUntil(keepLocally(request, key, bytes.slice(0)));
    return { bytes, from: "kv" };
  };

  /**
   * After an answer from the data center's stale copy of the pointer: reads
   * it from KV, and when the version in use moved on from `served`, readies
   * this request's page under the new one in the data center (from KV, or
   * built and kept), so the next visitor gets it at once. Never fails.
   */
  const revalidate = async (
    request: Request,
    served: string,
    context: WaitUntil,
  ): Promise<void> => {
    if (refreshing) return;
    refreshing = true;
    try {
      const pointer = await fetchPointer(request, context);
      if (pointer === "unreachable") return;
      if (pointer === undefined || now() - pointer.checkedAt >= checkEvery) {
        context.waitUntil(check(request, pointer));
      }
      if (pointer === undefined) return;
      const at = now();
      const state = effectiveState(pointer, at);
      if (state === undefined || state.version === served) return;
      const key = await pageKey(request, build, state, at);
      if ((await findPage(request, key, context)) !== undefined) return;
      const response = await handle(
        new Request(request.url, { headers: request.headers }),
        context,
      );
      if (
        keepable(response) &&
        effectiveState(pointer, now())?.version === state.version &&
        windowAt(state.boundaries, now()) === windowAt(state.boundaries, at)
      ) {
        const bytes = await keptBytes(response);
        await pages
          .put(key, bytes.slice(0), { expirationTtl: keepFor })
          .catch(() => undefined);
        await keepLocally(request, key, bytes);
      } else {
        await response.body?.cancel();
      }
    } catch {
      // The next visitor that finds the copy stale tries again.
    } finally {
      refreshing = false;
    }
  };

  /** Asks the database, and records what it said; never fails. */
  const check = async (request: Request, pointer: SitePointer | undefined) => {
    if (checking) return;
    checking = true;
    try {
      const state = await siteState();
      const at = now();
      const next = nextPointer(pointer, state, at, turnover);
      await pages.put(siteKey, JSON.stringify(next));
      await remember(request, next, at);
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
    const { pointer, stale } = await readPointer(request, context);
    if (pointer === "unreachable") return bypass();
    // A stale copy is no ground for a check: it may be older than KV's
    // pointer, which revalidate reads, and checks from, instead.
    if (
      !stale &&
      (pointer === undefined || now() - pointer.checkedAt >= checkEvery)
    ) {
      context.waitUntil(check(request, pointer));
    }
    const at = now();
    const state =
      pointer === undefined ? undefined : effectiveState(pointer, at);
    if (state === undefined) return bypass();

    const key = await pageKey(request, build, state, at);
    if (stale) context.waitUntil(revalidate(request, state.version, context));
    const found = await findPage(request, key, context);
    const lookup = now() - started;
    const kept =
      found === undefined ? undefined : servedFrom(found.bytes, request);
    if (kept !== undefined && found !== undefined) {
      return withCopy(withTiming(kept, "hit", lookup), found.from);
    }

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
      const keep = async (): Promise<Keeping> => {
        try {
          const value = await keptBytes(copy);
          await pages.put(key, value.slice(0), { expirationTtl: keepFor });
          await keepLocally(request, key, value);
          return { kept: true };
        } catch {
          return { kept: false };
        }
      };
      context.waitUntil(keep());
    }
    return withTiming(withoutInternalHeaders(response), "miss", lookup);
  };
}
