import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  networkFailure,
  parseRpcBody,
  toolResultSchema,
  type Fetch,
} from "./client.ts";
import {
  auxCodePath,
  auxCodeVariable,
  auxEndpointVariable,
  commandName,
} from "./config.ts";
import { CliError, ExitCode } from "./errors.ts";

/**
 * `allthings aux`: the room's lights at an evening that passes the aux,
 * through the aux hub's MCP server. Every call carries the guest's code as a
 * bearer token, and a refusal is a tool error with a stable `code`.
 */

/** The music tools. A hub without music leaves them out of tools/list. */
export const musicTools = ["list_tracks", "queue_track", "skip_track"] as const;
type MusicTool = (typeof musicTools)[number];

/** A code fits in a header and on a card: printable ASCII, no spaces. */
const codePattern = /^[\x21-\x7E]{1,256}$/;

const errorDetailSchema = z.object({
  code: z.string(),
  retry_after_seconds: z.number().nonnegative().optional(),
  message: z.string().optional(),
});

const toolListSchema = z.object({
  tools: z.array(z.object({ name: z.string() })),
});

export type AuxStatus = {
  holder: string | null;
  queuePosition: number | null;
  cooldownSeconds: number | null;
  frozen: boolean;
  scenes: string[];
  colors: string[];
};

const auxStatusSchema = z.object({
  holder: z.string().nullable(),
  queuePosition: z.number().int().nonnegative().nullable(),
  cooldownSeconds: z.number().nonnegative().nullable(),
  frozen: z.boolean(),
  scenes: z.array(z.string()),
  colors: z.array(z.string()),
});

const trackListSchema = z.object({
  tracks: z.array(z.object({ slug: z.string(), title: z.string().optional() })),
});

export type Track = z.infer<typeof trackListSchema>["tracks"][number];

/** What a tool answered: its structured result and its text. */
export type AuxResult = { data: unknown; text: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The first of `keys` that `data` has, snake_case or camelCase. */
function field(data: Record<string, unknown>, ...keys: string[]): unknown {
  const key = keys.find((name) => name in data);
  return key === undefined ? undefined : data[key];
}

/**
 * aux_status's result: the holder, your place in line, your cooldown, whether
 * the host froze guest control, and tonight's scenes and colors. Null when
 * the hub's result has another shape.
 */
export function parseAuxStatus(data: unknown): AuxStatus | null {
  const value = record(data);
  if (value === null) return null;
  const parsed = auxStatusSchema.safeParse({
    holder: field(value, "holder"),
    queuePosition: field(value, "queue_position", "queuePosition"),
    cooldownSeconds: field(value, "cooldown_seconds", "cooldownSeconds"),
    frozen: field(value, "frozen"),
    scenes: field(value, "scenes"),
    colors: field(value, "colors"),
  });
  return parsed.success ? parsed.data : null;
}

/** list_tracks's tracks, or null when the result has another shape. */
export function parseTracks(data: unknown): Track[] | null {
  const parsed = trackListSchema.safeParse(data);
  return parsed.success ? parsed.data.tracks : null;
}

/** Your place in line from request_aux's result, when it says. */
export function queuePositionOf(data: unknown): number | null {
  const value = record(data);
  if (value === null) return null;
  const position = field(value, "queue_position", "queuePosition");
  return typeof position === "number" ? position : null;
}

/** "try again in 12 s", rounded up to a whole second. */
function tryAgain(seconds: number | undefined): string {
  return seconds === undefined
    ? "try again in a few seconds"
    : `try again in ${Math.max(1, Math.ceil(seconds))} s`;
}

/**
 * A Retry-After header in seconds: a number of seconds or an HTTP date.
 * Undefined when it is absent or unreadable.
 */
export function retryAfterSeconds(
  header: string | null,
  now: number,
): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - now) / 1000);
}

const unauthorized = () =>
  new CliError(
    `The hub didn't accept your code. Check your card, then run "${commandName} aux login <code>" again.`,
    ExitCode.ServiceError,
  );

/** The friendly message for each of the hub's error codes. */
function toolError(
  args: Record<string, unknown>,
  structured: unknown,
  parts: string[],
): CliError {
  const candidates = [
    structured,
    ...parts.map((text) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    }),
  ];
  const detail = candidates
    .map((candidate) => errorDetailSchema.safeParse(candidate))
    .find((parsed) => parsed.success)?.data;
  if (detail === undefined) {
    const text = parts.join("\n").trim();
    return new CliError(text || "The hub refused that.", ExitCode.ServiceError);
  }
  switch (detail.code) {
    case "rate_limited":
      return new CliError(
        `You're going a little fast: ${tryAgain(detail.retry_after_seconds)}.`,
        ExitCode.ServiceError,
      );
    case "frozen":
      return new CliError(
        "The host has paused guest control for now. Try again in a bit.",
        ExitCode.ServiceError,
      );
    case "unknown_scene":
      return new CliError(
        `Tonight has no scene called "${String(args["scene"])}". Run "${commandName} aux scenes" to see them.`,
        ExitCode.UsageError,
      );
    case "unknown_color":
      return new CliError(
        `Tonight has no color called "${String(args["color"])}". Run "${commandName} aux status" to see them.`,
        ExitCode.UsageError,
      );
    case "not_holder":
      return new CliError(
        `Only the person holding the aux can do that. Run "${commandName} aux request" to get in line.`,
        ExitCode.ServiceError,
      );
    case "unauthorized":
      return unauthorized();
    default:
      return new CliError(
        detail.message ?? `The hub refused that (${detail.code}).`,
        ExitCode.ServiceError,
      );
  }
}

const loopbackNames = new Set(["localhost", "[::1]", "::1"]);
const loopbackIPv4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Whether `hostname` is this machine: localhost, ::1, or a 127.0.0.0/8 address. */
export function isLoopbackHost(hostname: string): boolean {
  if (loopbackNames.has(hostname)) return true;
  const match = loopbackIPv4.exec(hostname);
  return (
    match !== null && match.slice(1).every((octet) => Number(octet) <= 255)
  );
}

/**
 * The hub's endpoint, checked before any code is sent to it: HTTPS, or plain
 * HTTP only to a hub on this machine. Anything else is a usage error.
 */
export function checkedAuxEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new CliError(
      `${auxEndpointVariable} isn't a URL: set it to the hub's https address, or unset it for ${commandName}'s default.`,
      ExitCode.UsageError,
    );
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) {
    return url;
  }
  throw new CliError(
    `${auxEndpointVariable} must be an https address, or http to a hub on this machine, so your code is never sent in the clear.`,
    ExitCode.UsageError,
  );
}

export function createAuxClient({
  endpoint,
  code,
  fetch = globalThis.fetch,
  now = Date.now,
}: {
  endpoint: string;
  code: string;
  fetch?: Fetch | undefined;
  now?: () => number;
}) {
  const url = checkedAuxEndpoint(endpoint).href;
  async function post<T>(
    method: string,
    params: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          authorization: `Bearer ${code}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw networkFailure(endpoint, error);
    }
    if (response.status === 429) {
      const wait = retryAfterSeconds(
        response.headers.get("retry-after"),
        now(),
      );
      throw new CliError(
        `The hub is busy: ${tryAgain(wait)}.`,
        ExitCode.ServiceError,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw unauthorized();
    }
    if (!response.ok) {
      throw new CliError(
        `${endpoint} answered ${response.status} ${response.statusText}`.trim(),
        ExitCode.ServiceError,
      );
    }

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw networkFailure(endpoint, error);
    }
    const rpcSchema = z.union([
      z.object({ result: schema }),
      z.object({ error: z.object({ message: z.string() }) }),
    ]);
    let rpc: z.infer<typeof rpcSchema>;
    try {
      rpc = rpcSchema.parse(
        parseRpcBody(body, response.headers.get("content-type") ?? ""),
      );
    } catch {
      throw new CliError(
        `Unexpected response from ${endpoint}`,
        ExitCode.ServiceError,
      );
    }
    if ("error" in rpc) {
      throw new CliError(rpc.error.message, ExitCode.ServiceError);
    }
    return rpc.result;
  }

  async function callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<AuxResult> {
    const result = await post(
      "tools/call",
      { name, arguments: args },
      toolResultSchema,
    );
    const parts = result.content.map((part) => part.text ?? "");
    if (result.isError) {
      throw toolError(args, result.structuredContent, parts);
    }
    return {
      data: result.structuredContent ?? {},
      text: parts.join("\n").trim(),
    };
  }

  /** Calls a music tool, once tools/list shows music is on tonight. */
  async function callMusicTool(
    name: MusicTool,
    args: Record<string, unknown>,
  ): Promise<AuxResult> {
    const { tools } = await post("tools/list", {}, toolListSchema);
    if (!tools.some((tool) => tool.name === name)) {
      throw new CliError(
        "Music isn't on tonight, so there are no tracks to list, queue or skip.",
        ExitCode.ServiceError,
      );
    }
    return callTool(name, args);
  }

  return {
    status: () => callTool("aux_status", {}),
    setScene: (scene: string) => callTool("set_scene", { scene }),
    setColor: (color: string, zone: string | undefined) =>
      callTool("set_color", zone === undefined ? { color } : { color, zone }),
    requestAux: () => callTool("request_aux", {}),
    passAux: () => callTool("pass_aux", {}),
    listTracks: () => callMusicTool("list_tracks", {}),
    queueTrack: (slug: string) => callMusicTool("queue_track", { slug }),
    skipTrack: () => callMusicTool("skip_track", {}),
  };
}

export type AuxClient = ReturnType<typeof createAuxClient>;

/** A code as typed, or a usage error that never repeats it. */
export function checkedCode(code: string, from: string): string {
  const trimmed = code.trim();
  if (!codePattern.test(trimmed)) {
    throw new CliError(
      `${from} doesn't look like an aux code. Type it as printed on your card, without spaces.`,
      ExitCode.UsageError,
    );
  }
  return trimmed;
}

/**
 * The guest's code: ALLTHINGS_AUX_CODE when set, else the one `aux login`
 * saved, else null.
 */
export async function readAuxCode(
  env: Record<string, string | undefined>,
): Promise<string | null> {
  const fromEnv = env[auxCodeVariable];
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return checkedCode(fromEnv, auxCodeVariable);
  }
  const path = auxCodePath(env);
  let saved: string;
  try {
    saved = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CliError(
      `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.ServiceError,
    );
  }
  return saved.trim() === "" ? null : checkedCode(saved, path);
}

/**
 * Saves the code for later commands, readable by its owner alone (0600), and
 * returns where. An existing file is narrowed to 0600 before the new code is
 * written into it.
 */
export async function saveAuxCode(
  env: Record<string, string | undefined>,
  code: string,
): Promise<string> {
  const path = auxCodePath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await chmod(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path, `${code}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
