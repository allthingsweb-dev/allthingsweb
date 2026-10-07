import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import packageJson from "../../package.json" with { type: "json" };
import { registerTools, type RunTool } from "./tools.ts";

/**
 * The MCP server: the official SDK's web-standard handler, as the app serves
 * it through mcp-handler. Every request gets a fresh server (stateless, no
 * sessions); requests from 2025-era clients, such as the CLI, are served by
 * the SDK's stateless fallback, exactly as today.
 *
 * The SDK and zod are most of the Worker's code but serve only `/mcp`, so
 * this module is loaded the first time an isolate is asked for it (see
 * endpoint.ts), never on the pages' cold start.
 */
export function mcpHandler(
  run: RunTool,
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({
        name: "allthings",
        version: packageJson.version,
      });
      registerTools(server, run);
      return server;
    },
    { legacy: "stateless" },
  );
  return (request) => handler.fetch(request);
}
