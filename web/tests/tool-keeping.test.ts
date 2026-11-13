import { describe, expect, test } from "bun:test";
import { isKeptTool, toolInputs, toolKeeping } from "../src/mcp/tools.ts";

/**
 * Which MCP tools' answers the page store keeps (web/src/mcp/tools.ts,
 * `toolKeeping`): every tool says, and one that isn't kept says why.
 */

describe("tool keeping", () => {
  test("names every tool, and only tools", () => {
    expect(Object.keys(toolKeeping).toSorted()).toEqual(
      Object.keys(toolInputs).toSorted(),
    );
  });

  test("a tool that isn't kept says why", () => {
    for (const keeping of Object.values(toolKeeping)) {
      if (!keeping.kept) expect(keeping.why.trim().length).toBeGreaterThan(20);
    }
  });

  test("keeps every tool that reads public data, and not coach_talk", () => {
    const notKept = Object.entries(toolKeeping)
      .filter(([, keeping]) => !keeping.kept)
      .map(([name]) => name);
    // Adding one here is a decision: the tool's answers would then always
    // be read fresh, never from the store.
    expect(notKept).toEqual(["coach_talk"]);
    for (const name of Object.keys(toolInputs)) {
      expect(isKeptTool(name)).toBe(!notKept.includes(name));
    }
    expect(isKeptTool("no_such_tool")).toBe(false);
  });
});
