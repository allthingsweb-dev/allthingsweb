import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/server";
import { proposeToolName } from "../src/mcp/propose.ts";
import { registerTools, toolInputs } from "../src/mcp/tools.ts";

/**
 * The plugin's README (plugins/allthings/README.md) names the MCP server's
 * tools, in the order the server lists them: a tool added to the server
 * fails this until the README says so too.
 */

/** The tools `registerTools` registers, in order. */
function registered(): ReadonlyArray<string> {
  const names: Array<string> = [];
  const server = {
    registerTool: (name: string) => {
      names.push(name);
    },
  } as unknown as McpServer;
  const answer = async () => ({ content: [] });
  registerTools(server, answer, answer);
  return names;
}

describe("the plugin's README", () => {
  test("names every tool the MCP server lists, in its order", async () => {
    const readme = await Bun.file(
      new URL("../../plugins/allthings/README.md", import.meta.url),
    ).text();
    const list = /the allthings MCP server \(([^)]*)\)/.exec(readme)?.[1];
    expect(list).toBeDefined();
    const named = [...(list ?? "").matchAll(/`([a-z_]+)`/g)].map(
      ([, name]) => name,
    );
    expect(named).toEqual([...registered()]);
    // Every tool with an input schema is registered, and only those, with
    // propose_talk, whose input is its own (propose.ts).
    expect(registered().toSorted()).toEqual(
      [...Object.keys(toolInputs), proposeToolName].toSorted(),
    );
  });
});
