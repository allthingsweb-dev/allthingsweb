/** The site the CLI talks to: its MCP server is at `/mcp`. */
export const siteOrigin = "https://allthings.dev";

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
