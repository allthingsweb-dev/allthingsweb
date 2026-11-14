import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import mcpSchema from "./fixtures/agent-plugins/mcp.schema.json" with { type: "json" };
import pluginSchema from "./fixtures/agent-plugins/plugin.schema.json" with { type: "json" };
import { manifests, plugin, text } from "../src/manifests.ts";

// The schemas are Agent Plugins 1.0.0's own, as published at
// https://agent-plugins.org/schemas/1.0.0/.

const root = join(import.meta.dir, "../../..");
const pluginRoot = join(root, plugin.directory);

function errors(schema: object, data: unknown): unknown[] {
  const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  return check(data) ? [] : [...(check.errors ?? [])];
}

function written(path: string): unknown {
  const manifest = manifests().find((each) => each.path === path);
  expect(manifest).toBeDefined();
  return manifest?.json;
}

describe("the allthings plugin's manifests", () => {
  test.each(manifests().map((manifest) => [manifest.path, manifest]))(
    "%s is what the definition writes (bun run write)",
    async (path, manifest) => {
      expect(await Bun.file(join(root, path)).text()).toBe(text(manifest));
    },
  );

  test("plugin.json satisfies the Agent Plugins manifest schema", () => {
    expect(
      errors(pluginSchema, written(`${plugin.directory}/plugin.json`)),
    ).toEqual([]);
  });

  test.each(["mcp.json", ".mcp.json"])(
    "%s satisfies the Agent Plugins MCP schema and names the public HTTPS server",
    (file) => {
      const config = written(`${plugin.directory}/${file}`);
      expect(errors(mcpSchema, config)).toEqual([]);
      expect(config).toMatchObject({
        mcpServers: {
          allthings: {
            type: "streamable-http",
            url: "https://allthings.dev/mcp",
          },
        },
      });
    },
  );

  test("every asset Codex shows is a ./ path inside the plugin that exists", () => {
    const { composerIcon, logo } = plugin.codex.interface;
    for (const asset of [composerIcon, logo]) {
      expect(asset).toStartWith("./");
      const path = join(pluginRoot, asset);
      expect(existsSync(path)).toBe(true);
      // Real paths, so a symlink can't lead outside the plugin.
      const inside = relative(realpathSync(pluginRoot), realpathSync(path));
      expect(inside.startsWith("..") || isAbsolute(inside)).toBe(false);
    }
  });

  test("every skill is named for its folder and says when to use it", async () => {
    const skills = readdirSync(join(pluginRoot, "skills"));
    expect(skills.toSorted()).toEqual(["evening-briefing", "find-evenings"]);
    for (const skill of skills) {
      const source = await Bun.file(
        join(pluginRoot, "skills", skill, "SKILL.md"),
      ).text();
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1] ?? "";
      expect(frontmatter).toMatch(new RegExp(`^name: ${skill}$`, "m"));
      expect(frontmatter).toMatch(/^description: .{40,}$/m);
    }
  });

  test("both marketplaces list the plugin from its directory, which holds both manifests", () => {
    for (const manifestPath of ["plugin.json", ".claude-plugin/plugin.json"]) {
      expect(existsSync(join(pluginRoot, manifestPath))).toBe(true);
    }
    expect(written(".claude-plugin/marketplace.json")).toMatchObject({
      plugins: [{ name: plugin.name, source: `./${plugin.directory}` }],
    });
    expect(written(".agents/plugins/marketplace.json")).toMatchObject({
      plugins: [
        {
          name: plugin.name,
          source: { source: "local", path: `./${plugin.directory}` },
        },
      ],
    });
  });
});
