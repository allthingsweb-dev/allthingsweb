import { immutable } from "../cache.ts";

/**
 * A photo variant already made, answered before the app loads (worker.ts):
 * from the data center's cache, else from the stage's variants bucket
 * (`VARIANTS`, infra/src/web.ts), which every data center shares. Only a
 * variant neither has goes on to the app, which makes it (route.ts) and
 * keeps it in both.
 *
 * This module is all a cold isolate parses to answer a kept variant: the
 * app (Effect's router, the pages) is most of the bundle, and a page shows
 * dozens of photos at once, each request perhaps starting an isolate of
 * its own.
 */

/** Where image variants are served (images/variants.ts). */
export const variantPrefix = "/img/";

/** What the Worker uses of an R2 bucket's object. */
export interface StoredVariant {
  readonly body: ReadableStream<Uint8Array>;
  readonly httpMetadata?: { readonly contentType?: string };
}

/** What the Worker uses of the `VARIANTS` R2 bucket. */
export interface VariantStore {
  get(key: string): Promise<StoredVariant | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer,
    options: { readonly httpMetadata: { readonly contentType: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** What the Worker uses of `caches.default`. */
export interface VariantCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

const hasMethods = (value: unknown, ...names: Array<string>): boolean =>
  typeof value === "object" &&
  value !== null &&
  names.every(
    (name) => typeof (value as Record<string, unknown>)[name] === "function",
  );

/** The `VARIANTS` binding, if the Worker has one. */
export const variantStoreOf = (
  env: Readonly<Record<string, unknown>>,
): VariantStore | undefined => {
  const store = env["VARIANTS"];
  return hasMethods(store, "get", "put", "delete")
    ? (store as VariantStore)
    : undefined;
};

/** The data center's cache, where the runtime has one. */
export const variantCache = (): VariantCache | undefined => {
  const cache = (globalThis as { caches?: { default?: unknown } }).caches
    ?.default;
  return hasMethods(cache, "match", "put")
    ? (cache as VariantCache)
    : undefined;
};

/** The key a variant is kept under in the data center's cache: one per URL path, whatever the query. */
export const cacheKeyOf = (url: URL): string => `${url.origin}${url.pathname}`;

/** The key a variant is kept under in the bucket: its path below /img/. */
export const storeKeyOf = (url: URL): string =>
  url.pathname.slice(variantPrefix.length);

/** The headers every variant made is sent with. */
export const variantHeaders = (contentType: string) => ({
  "content-type": contentType,
  "cache-control": immutable,
  "x-content-type-options": "nosniff",
});

const withTiming = (response: Response, timing: string): Response => {
  const headers = new Headers(response.headers);
  headers.set("server-timing", timing);
  return new Response(response.body, { status: response.status, headers });
};

/**
 * The variant `request` asks for, when it is kept: undefined for anything
 * else (not a GET of /img/, or a variant not made yet), which the app
 * answers. Neither store failing is an error: it is a miss.
 */
export async function keptVariant(
  request: Request,
  store: VariantStore | undefined,
  waitUntil: (promise: Promise<unknown>) => void,
  cache: VariantCache | undefined = variantCache(),
): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(variantPrefix)) return undefined;
  const cacheKey = cacheKeyOf(url);
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit !== undefined) return withTiming(hit, 'img;desc="hit"');
  if (store === undefined) return undefined;
  const started = Date.now();
  const stored = await store.get(storeKeyOf(url)).catch(() => null);
  const contentType = stored?.httpMetadata?.contentType;
  if (stored === null || contentType === undefined) {
    // A malformed object is a miss, even when its body won't cancel.
    await stored?.body.cancel().catch(() => undefined);
    return undefined;
  }
  const headers = variantHeaders(contentType);
  let body = stored.body;
  if (cache !== undefined) {
    const [sent, kept] = body.tee();
    body = sent;
    // A copy that can't be kept here is read from the bucket next time.
    waitUntil(
      cache
        .put(cacheKey, new Response(kept, { headers }))
        .catch(() => undefined),
    );
  }
  return new Response(body, {
    headers: {
      ...headers,
      "server-timing": `img;desc="stored";dur=${Date.now() - started}`,
    },
  });
}

/** Where the deploy check's objects go: never under a variant's path. */
export const checkPrefix = "deploy-checks/";

/**
 * The deploy's proof that the bucket takes writes (infra/src/web.ts's
 * VariantsCheck, through refresh.ts's `variantsCheckRequest`): one object
 * of its own, stored, read back, deleted and looked for again. It throws,
 * naming the step, when one doesn't hold; the object is deleted either way.
 */
export async function checkVariantStore(
  store: VariantStore,
): Promise<{ readonly checked: string }> {
  const key = `${checkPrefix}${crypto.randomUUID()}.txt`;
  const body = new TextEncoder().encode("ok");
  try {
    await store.put(key, body.buffer, {
      httpMetadata: { contentType: "text/plain" },
    });
    const stored = await store.get(key);
    const text =
      stored === null ? undefined : await new Response(stored.body).text();
    if (text !== "ok") throw new Error("the object didn't read back");
  } finally {
    await store.delete(key);
  }
  const gone = await store.get(key);
  if (gone !== null) {
    await gone.body.cancel().catch(() => undefined);
    throw new Error("the object is still there after its delete");
  }
  return { checked: key };
}
