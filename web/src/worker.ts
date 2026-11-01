import type { ExecutionContext } from "./app.ts";
import { built } from "./assets.ts";
import { dataCenterCache, edgeCached } from "./edge-cache.ts";

type Handler = (
  request: Request,
  context: ExecutionContext,
) => Promise<Response>;

let handle: Handler | undefined;

/**
 * The app (app.ts), loaded on first use. Everything it imports (Effect's
 * router and SQL client, the pages, the brand's tokens) is most of the
 * bundle, so a cold isolate whose request the cache answers never parses
 * it: this module and the cache import only what keys and serves a kept
 * copy (web/tests/support/stack.ts holds the startup modules to a budget).
 * The first request the cache can't answer loads it, once per isolate.
 */
const lazyApp = (env: Readonly<Record<string, unknown>>): Handler => {
  let app: Promise<Handler> | undefined;
  return async (request, context) => {
    app ??= import("./app.ts").then(
      ({ makeHandler }) => makeHandler(env),
      (cause: unknown) => {
        // A module that failed to load is loaded again by the next request.
        app = undefined;
        throw cause;
      },
    );
    const handler = await app;
    return handler(request, context);
  };
};

/**
 * The allthings Worker. Bindings are fixed for an isolate's lifetime, so the
 * handler is made on the first request and reused. With an `EDGE_CACHE`
 * binding, every GET goes through the data center's cache first (see
 * edge-cache.ts), under that binding's name: deployments set it, and tests
 * give each Worker its own, so Workers that share a runtime (and its cache)
 * never share pages.
 */
export default {
  fetch(
    request: Request,
    env: Readonly<Record<string, unknown>>,
    context: ExecutionContext,
  ): Promise<Response> {
    if (handle === undefined) {
      const app = lazyApp(env);
      const cache = dataCenterCache();
      const name = env["EDGE_CACHE"];
      handle =
        cache === undefined || typeof name !== "string" || name === ""
          ? app
          : edgeCached(app, {
              cache,
              build: `${name}/${built.build}`,
              now: Date.now,
            });
    }
    return handle(request, context);
  },
};
