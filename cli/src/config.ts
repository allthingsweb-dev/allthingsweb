import { homedir } from "node:os";
import { join } from "node:path";

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

/**
 * The aux hub at an evening that passes the aux: its MCP server, reached
 * through a Cloudflare Tunnel from the hub laptop in the room.
 */
export const defaultAuxEndpoint = "https://aux.allthings.dev/mcp";

/** The environment variable that points `aux` at another hub. */
export const auxEndpointVariable = "ALLTHINGS_AUX_URL";
/** The environment variable that holds an aux code, over the saved one. */
export const auxCodeVariable = "ALLTHINGS_AUX_CODE";
/** Where the installer puts allthings, as install.bash reads it. */
export const homeVariable = "ALLTHINGS_HOME";

/** The aux hub to use: the environment's choice, else {@link defaultAuxEndpoint}. */
export function auxEndpointFrom(
  env: Record<string, string | undefined>,
): string {
  const chosen = env[auxEndpointVariable]?.trim();
  return chosen ? chosen : defaultAuxEndpoint;
}

/**
 * Where `aux login` saves the code: beside the installed binary, in
 * ALLTHINGS_HOME (~/.allthings by default), readable by its owner alone.
 */
export function auxCodePath(env: Record<string, string | undefined>): string {
  return join(env[homeVariable] ?? join(homedir(), ".allthings"), "aux-code");
}
