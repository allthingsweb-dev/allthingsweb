import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import packageJson from "../../package.json" with { type: "json" };
import { type CallTool, registerTools } from "./tools.ts";

/**
 * The most array elements and object members a call's arguments may hold.
 * The largest real call has two (list_events' `when` and `limit`), so this
 * is far past any client's, and a call over it is answered with an error
 * before its schema runs (GHSA-46jr-4wx8-v453).
 */
export const maxToolInputElements = 64;

/**
 * The largest request body `/mcp` reads, in bytes: a client's `initialize`
 * with its capabilities is a few KiB and a tool call far less. A larger body
 * is answered 413 before it's parsed (GHSA-46jr-4wx8-v453); the SDK's own
 * default is 4 MiB.
 */
export const maxRequestBodySize = 64 * 1024;

/**
 * The MCP server: the official SDK's web-standard handler, as the app serves
 * it through mcp-handler. Every request gets a fresh server (stateless, no
 * sessions), as the SDK requires since 2.3.0; requests from 2025-era
 * clients, such as the CLI, are served by the SDK's stateless fallback,
 * exactly as today. `call` answers its tools (endpoint.ts), through the page
 * store where the Worker has one.
 *
 * The SDK and zod are most of the Worker's code but serve only `/mcp`, so
 * this module is loaded the first time an isolate is asked for it (see
 * endpoint.ts), never on the pages' cold start.
 */
export function mcpHandler(
  call: CallTool,
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "allthings", version: packageJson.version },
        { maxToolInputElements },
      );
      registerTools(server, call);
      return server;
    },
    { legacy: "stateless", maxRequestBodySize },
  );
  return (request) => handler.fetch(request);
}
