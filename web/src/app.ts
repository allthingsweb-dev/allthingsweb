import { ConfigProvider, Context, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { Hyperdrive } from "./database.ts";
import { imageRoutes, Images, WaitUntil } from "./images/route.ts";
import { Mcp, mcpRoute } from "./mcp/endpoint.ts";
import { Assets, ogRoutes } from "./og/route.ts";
import { pageRoutes } from "./pages/routes.ts";
import { seoRoutes } from "./seo/routes.ts";
import { Site } from "./site.ts";
import { v1Routes } from "./v1/routes.ts";

/** Every route the Worker serves. */
export const routes = Layer.mergeAll(
  v1Routes,
  mcpRoute,
  pageRoutes,
  seoRoutes,
  imageRoutes,
  ogRoutes,
);

/** What the Worker uses of a request's `ExecutionContext`. */
export interface ExecutionContext {
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * The Worker as a fetch handler, built once per isolate from its bindings.
 * Settings are read through Effect's `Config` from `env`; requests that read
 * data open their own database pool, on the `HYPERDRIVE` binding when there
 * is one (see database.ts), and image variants are made with the `IMAGES`
 * binding when there is one (see images/route.ts). Work that outlives a
 * response, such as storing a variant in the edge cache, is handed to the
 * request's `waitUntil`.
 */
export function makeHandler(
  env: Readonly<Record<string, unknown>>,
): (request: Request, context?: ExecutionContext) => Promise<Response> {
  const services = Layer.mergeAll(
    Site.layer,
    Mcp.layer.pipe(Layer.provide(Site.layer)),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
        Hyperdrive.layer(env),
        Images.layer(env),
        Assets.layer(env),
      ),
    ),
  );
  const { handler } = HttpRouter.toWebHandler(
    routes.pipe(Layer.provideMerge(services)),
    {
      disableLogger: true,
      // "/about/" is not "/about": the catch-all in pages/routes.ts redirects
      // it, as the current site does, so a page has one address.
      routerConfig: { ignoreTrailingSlash: false },
    },
  );
  return (request, context) =>
    handler(
      request,
      context === undefined
        ? undefined
        : Context.make(WaitUntil, (promise) => context.waitUntil(promise)),
    );
}
