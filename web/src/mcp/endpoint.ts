import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Context, Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import packageJson from "../../package.json" with { type: "json" };
import { Site } from "../site.ts";
import { registerTools } from "./tools.ts";

/**
 * The MCP server: the official SDK's web-standard handler, as the app serves
 * it through mcp-handler. Every request gets a fresh server (stateless, no
 * sessions); requests from 2025-era clients, such as the CLI, are served by
 * the SDK's stateless fallback, exactly as today.
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
      const handler = createMcpHandler(
        () => {
          const server = new McpServer({
            name: "all-things-web",
            version: packageJson.version,
          });
          registerTools(server, run);
          return server;
        },
        { legacy: "stateless" },
      );
      return Mcp.of({ fetch: (request) => handler.fetch(request) });
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
