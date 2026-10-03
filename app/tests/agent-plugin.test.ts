import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import pluginSchema from "./fixtures/agent-plugins/plugin.schema.json";
import mcpSchema from "./fixtures/agent-plugins/mcp.schema.json";

const repoRoot = join(import.meta.dir, "../..");
const pluginRoot = join(repoRoot, "plugins/all-things-web");

async function readJson(path: string) {
  return Bun.file(path).json();
}

function validate(schema: object, data: unknown) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const check = ajv.compile(schema);
  return check(data) ? [] : (check.errors ?? []);
}

describe("All Things Web agent plugin", () => {
  test("its manifest satisfies the Agent Plugins schema", async () => {
    expect(
      validate(pluginSchema, await readJson(join(pluginRoot, "plugin.json"))),
    ).toEqual([]);
  });

  test("its MCP configuration points at the public HTTPS server", async () => {
    const config = await readJson(join(pluginRoot, "mcp.json"));
    expect(validate(mcpSchema, config)).toEqual([]);
    expect(config.mcpServers["all-things-web"]).toEqual({
      type: "streamable-http",
      url: "https://allthingsweb.dev/mcp",
    });
  });

  test("every asset the manifest references exists", async () => {
    const manifest = await readJson(join(pluginRoot, "plugin.json"));
    const ui = manifest.extensions["com.openai"].interface;
    for (const asset of [ui.composerIcon, ui.logo]) {
      // Hosts require a ./-relative path that stays inside the plugin.
      expect(asset).toStartWith("./");
      const path = resolve(pluginRoot, asset);
      expect(existsSync(path)).toBe(true);
      // Compare real paths so a symlink can't point outside the plugin.
      const inside = relative(realpathSync(pluginRoot), realpathSync(path));
      expect(inside.startsWith("..") || isAbsolute(inside)).toBe(false);
    }
  });

  test("every skill declares a matching name and a description", async () => {
    for (const skill of ["find-events", "event-briefing"]) {
      const text = await Bun.file(
        join(pluginRoot, "skills", skill, "SKILL.md"),
      ).text();
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
      expect(frontmatter).toMatch(new RegExp(`^name: ${skill}$`, "m"));
      expect(frontmatter).toMatch(/^description: .{40,}$/m);
    }
  });

  test("the repository marketplace lists the plugin by a contained relative path", async () => {
    const marketplace = await readJson(
      join(repoRoot, ".agents/plugins/marketplace.json"),
    );
    const [entry] = marketplace.plugins;
    expect(entry.name).toBe("all-things-web");
    expect(entry.source.path).toBe("./plugins/all-things-web");
    expect(existsSync(join(repoRoot, entry.source.path, "plugin.json"))).toBe(
      true,
    );
    expect(entry.policy).toEqual({
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    });
    expect(entry.category).toBeTruthy();
  });
});
