import { type ExecutionContext, makeHandler } from "./app.ts";
import { built } from "./assets.ts";
import { dataCenterCache, edgeCached } from "./edge-cache.ts";

let handle:
  | ((request: Request, context: ExecutionContext) => Promise<Response>)
  | undefined;

/**
 * The all things Worker. Bindings are fixed for an isolate's lifetime, so the
 * router and its settings are built on the first request and reused. With
 * an `EDGE_CACHE` binding, every GET goes through the data center's cache
 * first (see edge-cache.ts), under that binding's name: deployments set it,
 * and tests give each Worker its own, so Workers that share a runtime (and
 * its cache) never share pages.
 */
export default {
  fetch(
    request: Request,
    env: Readonly<Record<string, unknown>>,
    context: ExecutionContext,
  ): Promise<Response> {
    if (handle === undefined) {
      const app = makeHandler(env);
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
