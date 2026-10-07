/**
 * The site the CLI talks to, and the one value that moves it. allthingsweb.dev
 * serves the MCP server until allthings.dev does: before the domain moves,
 * allthings.dev only redirects there, and a redirect drops an MCP POST. Flip
 * this to "https://allthings.dev" once the new site answers on it
 * (infra/docs/r2-migration.md, Phase 4).
 */
export const siteOrigin: "https://allthingsweb.dev" | "https://allthings.dev" =
  "https://allthingsweb.dev";

/** The public MCP server every command reads from. */
export const defaultEndpoint = `${siteOrigin}/mcp`;

/** The command's name, and the one it replaces, kept as an alias for now. */
export const commandName = "allthings";
export const legacyCommandName = "atw";

/** The environment variable that points the CLI at another MCP server. */
export const endpointVariable = "ALLTHINGS_MCP_URL";
/** Its old name, still read when the new one is unset. */
export const legacyEndpointVariable = "ATW_MCP_URL";

/**
 * Whether the CLI was started by its old name: an `atw` symlink to the
 * compiled binary, or `atw.exe`. `argv0` is the name it was invoked as.
 */
export function invokedAsLegacy(argv0: string): boolean {
  const base = argv0.split(/[\\/]/).at(-1) ?? "";
  return base.replace(/\.exe$/i, "") === legacyCommandName;
}

/** The MCP server to use: the environment's choice, else {@link defaultEndpoint}. */
export function endpointFrom(env: Record<string, string | undefined>): string {
  return (
    env[endpointVariable] ?? env[legacyEndpointVariable] ?? defaultEndpoint
  );
}
