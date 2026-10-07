import { describe, expect, test } from "bun:test";
import {
  defaultEndpoint,
  endpointFrom,
  invokedAsLegacy,
  siteOrigin,
} from "../src/config.ts";
import packageJson from "../package.json";

describe("config", () => {
  test("the default endpoint is the site's MCP server", () => {
    expect(defaultEndpoint).toBe(`${siteOrigin}/mcp`);
    // Until allthings.dev serves the new site, it only redirects, and a
    // redirect drops an MCP POST.
    expect(["https://allthingsweb.dev", "https://allthings.dev"]).toContain(
      siteOrigin,
    );
  });

  test("ALLTHINGS_MCP_URL wins, then ATW_MCP_URL, then the default", () => {
    expect(endpointFrom({})).toBe(defaultEndpoint);
    expect(endpointFrom({ ATW_MCP_URL: "https://old.test/mcp" })).toBe(
      "https://old.test/mcp",
    );
    expect(
      endpointFrom({
        ALLTHINGS_MCP_URL: "https://new.test/mcp",
        ATW_MCP_URL: "https://old.test/mcp",
      }),
    ).toBe("https://new.test/mcp");
  });

  test("knows when it was started by its old name", () => {
    for (const argv0 of [
      "atw",
      "./atw",
      "/home/me/.allthings/bin/atw",
      "C:\\bin\\atw.exe",
      "ATW.EXE".toLowerCase(),
    ]) {
      expect(invokedAsLegacy(argv0)).toBe(true);
    }
    for (const argv0 of [
      "allthings",
      "/usr/local/bin/allthings",
      "bun",
      "allthings.exe",
      "atw-cli",
      "",
    ]) {
      expect(invokedAsLegacy(argv0)).toBe(false);
    }
  });

  test("the package installs allthings, with atw as its alias", () => {
    expect(packageJson.name).toBe("allthings");
    expect(packageJson.bin).toEqual({
      allthings: "./src/index.ts",
      atw: "./src/atw.ts",
    });
  });
});
