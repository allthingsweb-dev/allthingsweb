import type { ExecutionContext } from "./app.ts";
import { forWorkersCache, prewarmPlan, withEdgePurge } from "./cache.ts";
import { built } from "./assets.ts";
import {
  dataCenterCache,
  type PageNamespace,
  pageStored,
  readSitePointer,
  refreshSite,
  type SiteState,
} from "./page-store.ts";
import { prewarm } from "./prewarm.ts";
import { readerTurnover } from "./reader-caching.ts";
import {
  prewarmPath,
  prewarmRequest,
  refreshPath,
  refreshRequest,
  variantsCheckPath,
  variantsCheckRequest,
} from "./refresh.ts";
import { withoutTrailingSlash } from "./trailing-slash.ts";
import {
  checkVariantStore,
  keptVariant,
  variantStoreOf,
} from "./images/kept.ts";

type Handler = (
  request: Request,
  context: ExecutionContext,
) => Promise<Response>;

let handle: Handler | undefined;

/**
 * The app (app.ts), loaded on first use. Everything it imports (Effect's
 * router and SQL client, the pages, the brand's tokens) is most of the
 * bundle, so a cold isolate whose request the store answers never parses
 * it: this module and the store import only what keys and serves a kept
 * page (web/tests/support/stack.ts holds the startup modules to a budget).
 * The first request that needs the app loads it, and the isolate keeps
 * what it made. Only what is made is kept, never the pending import: an
 * import belongs to the request that started it, and a request cancelled
 * mid-load would leave a promise no later request could settle. Each
 * request that finds nothing made imports the app itself; the module is
 * evaluated once, and they get the same one.
 */
const lazyApp = (
  env: Readonly<Record<string, unknown>>,
  /** The store in front of the app, once made, for `/mcp`'s tools. */
  through: () => Handler | undefined,
) => {
  let made:
    | { readonly app: Handler; readonly siteState: () => Promise<SiteState> }
    | undefined;
  const make = async () => {
    if (made === undefined) {
      const { makeHandler, makeSiteState } = await import("./app.ts");
      const store = through();
      made ??= {
        app: makeHandler(env, store === undefined ? {} : { through: store }),
        siteState: makeSiteState(env),
      };
    }
    return made;
  };
  const app: Handler = async (request, context) =>
    (await make()).app(request, context);
  return { app, siteState: async () => (await make()).siteState() };
};

/** The `PAGES` binding, if the Worker has one: a KV namespace. */
const pagesOf = (
  env: Readonly<Record<string, unknown>>,
): PageNamespace | undefined => {
  const pages: unknown = env["PAGES"];
  return typeof pages === "object" &&
    pages !== null &&
    typeof Reflect.get(pages, "get") === "function" &&
    typeof Reflect.get(pages, "put") === "function"
    ? (pages as PageNamespace)
    : undefined;
};

/**
 * The allthings Worker. Bindings are fixed for an isolate's lifetime, so the
 * handler is made on the first request and reused. With a `PAGES` binding,
 * every GET goes through the page store first (see page-store.ts):
 * deployments give each stage its own namespace, and tests each Worker.
 * A Worker that reads through Hyperdrive keeps pages of a new version of
 * the data only once Hyperdrive can't answer from before the change. With
 * `SITE_REFRESH_TOKEN` too, the writers tell it when the data changed
 * (refresh.ts).
 */
export default {
  fetch(
    request: Request,
    env: Readonly<Record<string, unknown>>,
    context: ExecutionContext,
  ): Promise<Response> {
    // Before anything else: it keeps nothing and reads nothing.
    const redirect = withoutTrailingSlash(request.url);
    // It answers before the store and the app, so it takes the edge rule here.
    if (redirect !== undefined) {
      return Promise.resolve(forWorkersCache(request, redirect));
    }
    if (handle === undefined) {
      let store: Handler | undefined;
      const { app, siteState } = lazyApp(env, () => store);
      const pages = pagesOf(env);
      const turnover = env["HYPERDRIVE"] === undefined ? 0 : readerTurnover;
      const token = env["SITE_REFRESH_TOKEN"];
      // Each data center's copies are named by the namespace (PAGES_ID).
      const pagesId = env["PAGES_ID"];
      const local =
        typeof pagesId === "string" && pagesId !== ""
          ? (() => {
              const cache = dataCenterCache();
              return cache === undefined ? undefined : { cache, id: pagesId };
            })()
          : undefined;
      const site =
        pages === undefined
          ? app
          : pageStored(app, {
              pages,
              build: built.build,
              now: Date.now,
              siteState,
              turnover,
              ...(local === undefined ? {} : { local }),
            });
      // `/mcp` answers its tools through the store (mcp/endpoint.ts).
      if (pages !== undefined) store = site;
      // Only a Worker with a store and a token answers the writers.
      const writers =
        pages === undefined || typeof token !== "string" || token.trim() === ""
          ? undefined
          : {
              token,
              refresh: () =>
                refreshSite({ pages, now: Date.now, siteState, turnover }),
              // Once the store holds the current pages, Workers Cache drops the
              // answers that show the data (cache.ts), so visitors get them now
              // rather than within the edge lifetime. The report says how it went.
              prewarm: withEdgePurge(() =>
                prewarm({
                  build: built.build,
                  serve: site,
                  pointer: () => readSitePointer(pages),
                  now: Date.now,
                  sleep: (ms) =>
                    new Promise((resolve) => setTimeout(resolve, ms)),
                }),
              ),
            };
      const noStore = () => Promise.reject(new Error("no store"));
      handle = (incoming, incomingContext) => {
        const { pathname } = new URL(incoming.url);
        if (pathname === refreshPath) {
          return refreshRequest(
            incoming,
            writers?.token,
            writers?.refresh ?? noStore,
          );
        }
        if (pathname === prewarmPath) {
          return prewarmRequest(
            incoming,
            writers?.token,
            writers === undefined
              ? noStore
              : () => writers.prewarm(incomingContext),
            // `?dry-run` answers the plan, and does nothing (cache.ts).
            () => prewarmPlan,
          );
        }
        if (pathname === variantsCheckPath) {
          const variants = variantStoreOf(env);
          return variantsCheckRequest(
            incoming,
            writers?.token,
            variants === undefined
              ? noStore
              : () => checkVariantStore(variants),
          );
        }
        return site(incoming, incomingContext);
      };
    }
    const app = handle;
    // A photo variant already made is answered before the app loads
    // (images/kept.ts); one not made yet goes on to it. Then what Workers
    // Cache may keep, and for how long (cache.ts), for every answer: the
    // writers' paths too, whose refusals carry no lifetime.
    return keptVariant(request, variantStoreOf(env), (promise) =>
      context.waitUntil(promise),
    )
      .then((kept) => kept ?? app(request, context))
      .then((response) => forWorkersCache(request, response));
  },
};
