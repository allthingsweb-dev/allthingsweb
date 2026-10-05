import { Context, Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Site } from "../site.ts";

/**
 * `/mcp`: the MCP server (server.ts). It is loaded with a dynamic import
 * the first time an isolate serves `/mcp`, so its SDK and zod stay out of
 * the code every cold start parses; the handler is then kept for the
 * isolate's life, as it was built at startup before.
 */
export class Mcp extends Context.Service<
  Mcp,
  { readonly fetch: (request: Request) => Promise<Response> }
>()("allthings/web/Mcp") {
  static readonly layer = Layer.effect(
    Mcp,
    Effect.gen(function* () {
      // The isolate's services (Site, config), for running tool programs.
      const context = yield* Effect.context<Site>();
      const run = Effect.runPromiseWith(context);
      let handler: Promise<(request: Request) => Promise<Response>> | undefined;
      return Mcp.of({
        fetch: async (request) => {
          handler ??= import("./server.ts").then(({ mcpHandler }) =>
            mcpHandler(run),
          );
          return (await handler)(request);
        },
      });
    }),
  );
}

/** `/mcp`, every method: the SDK answers the ones it doesn't serve with 405. */
export const mcpRoute = HttpRouter.add(
  "*",
  "/mcp",
  Effect.gen(function* () {
    const mcp = yield* Mcp;
    const request = yield* HttpServerRequest.toWeb(
      yield* HttpServerRequest.HttpServerRequest,
    );
    // The SDK's Response passes through untouched, streamed bodies included.
    return HttpServerResponse.raw(
      yield* Effect.promise(() => mcp.fetch(request)),
    );
  }),
);
