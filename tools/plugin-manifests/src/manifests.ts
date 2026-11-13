/**
 * The allthings agent plugin (plugins/allthings), defined once. Each agent
 * reads its own manifest, and this module writes every one of them from the
 * definition below, so a version, a keyword or the MCP server's URL changes
 * here and nowhere else. `bun run write` writes the files; a test fails when
 * a committed file differs from what this module makes.
 *
 * Who reads what:
 *
 * - Codex reads the Agent Plugins manifest (`plugin.json`, with its own
 *   settings under `extensions["com.openai"]`), the Agent Plugins MCP config
 *   (`mcp.json`) and the repository's `.agents/plugins/marketplace.json`.
 * - Grok Build reads `plugin.json` too, but finds MCP servers only in
 *   `.mcp.json`, and reads the marketplace from `.claude-plugin/`.
 * - Claude Code reads `.claude-plugin/plugin.json`, both MCP configs (a
 *   server named in both is one server) and `.claude-plugin/marketplace.json`.
 */

/** A file this module writes, by its path from the repository root. */
export type Manifest = {
  readonly path: string;
  readonly json: unknown;
};

const agentPluginsSchema = "https://agent-plugins.org/schemas/1.0.0";

/** The plugin, the marketplace that lists it, and the server it brings. */
export const plugin = {
  name: "allthings",
  version: "0.3.0",
  /** Where the plugin lives, from the repository root. */
  directory: "plugins/allthings",
  author: { name: "allthings", url: "https://allthings.dev" },
  homepage: "https://allthings.dev",
  repository: "https://github.com/allthings-sf/allthings",
  keywords: [
    "evenings",
    "meetups",
    "hackathons",
    "san francisco",
    "software",
    "community",
  ],
  /** What every agent's plugin does: the MCP server and the two skills. */
  description:
    "Find allthings evenings in San Francisco, for people who build software: what's coming up, who's on stage and what they built, who's hosting, and where to say you're in.",
  /** In Claude Code the plugin also brings the mod. */
  claudeCode: {
    description:
      "allthings evenings in San Francisco, for people who build software: the next evening above your prompt, /at and /imin, tool rows in the slash grammar, and the allthings themes and voice.",
    keywords: ["mod"],
    marketplaceDescription:
      "allthings evenings in San Francisco, for people who build software, in Claude Code.",
    entryDescription:
      "The next allthings evening above your prompt, /at and /imin, tool rows in the slash grammar, the allthings themes and voice, and the allthings MCP server.",
    category: "community",
    types: "./types/index.d.ts",
  },
  codex: {
    interface: {
      displayName: "allthings",
      shortDescription: "Evenings for people who build software in SF",
      category: "Productivity",
      composerIcon: "./assets/icon.png",
      logo: "./assets/logo.png",
    },
  },
  mcp: {
    name: "allthings",
    url: "https://allthings.dev/mcp",
  },
} as const;

/** The MCP server, in the Agent Plugins format every agent here accepts. */
const mcpConfig = {
  $schema: `${agentPluginsSchema}/mcp.schema.json`,
  mcpServers: {
    [plugin.mcp.name]: { type: "streamable-http", url: plugin.mcp.url },
  },
};

const pluginPath = `./${plugin.directory}`;

/** Every manifest, in the order `bun run write` writes them. */
export function manifests(): ReadonlyArray<Manifest> {
  const { claudeCode, codex } = plugin;
  return [
    {
      path: `${plugin.directory}/plugin.json`,
      json: {
        $schema: `${agentPluginsSchema}/plugin.schema.json`,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        homepage: plugin.homepage,
        repository: plugin.repository,
        keywords: plugin.keywords,
        extensions: { "com.openai": { interface: codex.interface } },
      },
    },
    { path: `${plugin.directory}/mcp.json`, json: mcpConfig },
    { path: `${plugin.directory}/.mcp.json`, json: mcpConfig },
    {
      path: `${plugin.directory}/.claude-plugin/plugin.json`,
      json: {
        name: plugin.name,
        version: plugin.version,
        description: claudeCode.description,
        author: plugin.author,
        homepage: plugin.homepage,
        repository: plugin.repository,
        keywords: [...plugin.keywords, ...claudeCode.keywords],
        mcpServers: "./mcp.json",
        types: claudeCode.types,
      },
    },
    {
      path: ".claude-plugin/marketplace.json",
      json: {
        $schema: "https://json.schemastore.org/claude-code-marketplace.json",
        name: plugin.name,
        description: claudeCode.marketplaceDescription,
        owner: plugin.author,
        plugins: [
          {
            name: plugin.name,
            source: pluginPath,
            description: claudeCode.entryDescription,
            category: claudeCode.category,
          },
        ],
      },
    },
    {
      path: ".agents/plugins/marketplace.json",
      json: {
        name: plugin.name,
        interface: { displayName: codex.interface.displayName },
        plugins: [
          {
            name: plugin.name,
            source: { source: "local", path: pluginPath },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: codex.interface.category,
          },
        ],
      },
    },
  ];
}

/** A manifest's text as written: two-space JSON and a final newline. */
export function text(manifest: Manifest): string {
  return `${JSON.stringify(manifest.json, null, 2)}\n`;
}
