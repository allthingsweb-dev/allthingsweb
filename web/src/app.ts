import { ConfigProvider, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { Hyperdrive } from "./database.ts";
import { Mcp, mcpRoute } from "./mcp/endpoint.ts";
import { pageRoutes } from "./pages/routes.ts";
import { seoRoutes } from "./seo/routes.ts";
import { Site } from "./site.ts";
import { v1Routes } from "./v1/routes.ts";

/** Every route the Worker serves. */
export const routes = Layer.mergeAll(v1Routes, mcpRoute, pageRoutes, seoRoutes);

/**
 * The Worker as a fetch handler, built once per isolate from its bindings.
 * Settings are read through Effect's `Config` from `env`; requests that read
 * data open their own database pool, on the `HYPERDRIVE` binding when there
 * is one (see database.ts).
 */
export function makeHandler(
  env: Readonly<Record<string, unknown>>,
): (request: Request) => Promise<Response> {
  const services = Layer.mergeAll(
    Site.layer,
    Mcp.layer.pipe(Layer.provide(Site.layer)),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
        Hyperdrive.layer(env),
      ),
    ),
  );
  const { handler } = HttpRouter.toWebHandler(
    routes.pipe(Layer.provideMerge(services)),
    { disableLogger: true },
  );
  return (request) => handler(request);
}
