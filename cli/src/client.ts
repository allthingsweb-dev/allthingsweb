import { z } from "zod";
import { commandName, defaultEndpoint } from "./config.ts";
import { CliError, ExitCode } from "./errors.ts";
import {
  communitySchema,
  eventListSchema,
  eventSchema,
  speakerListSchema,
  type Community,
  type Event,
  type EventSummary,
  type Speaker,
} from "./schemas.ts";

/**
 * Whether a get_event tool error means the slug has no published event. The
 * contract test checks this against the server's own message.
 */
export function isEventNotFound(message: string): boolean {
  return message.startsWith("No published event");
}

function networkFailure(endpoint: string, error: unknown): CliError {
  const reason =
    error instanceof Error && error.name === "TimeoutError"
      ? "timed out"
      : error instanceof Error
        ? error.message
        : String(error);
  return new CliError(
    `Could not reach ${endpoint}: ${reason}`,
    ExitCode.ServiceError,
  );
}

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  structuredContent: z.unknown().optional(),
});

const rpcResponseSchema = z.union([
  z.object({ result: toolResultSchema }),
  z.object({ error: z.object({ message: z.string() }) }),
]);

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Reads a single JSON-RPC message from a JSON or event-stream response. */
function parseRpcBody(body: string, contentType: string): unknown {
  if (!contentType.includes("text/event-stream")) return JSON.parse(body);
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("");
  return JSON.parse(data);
}

export function createClient({
  endpoint = defaultEndpoint,
  fetch = globalThis.fetch,
}: { endpoint?: string; fetch?: Fetch } = {}) {
  async function callTool<T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw networkFailure(endpoint, error);
    }
    if (!response.ok) {
      throw new CliError(
        `${endpoint} answered ${response.status} ${response.statusText}`.trim(),
        ExitCode.ServiceError,
      );
    }

    // The timeout also covers reading the body, which a slow stream can hit.
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw networkFailure(endpoint, error);
    }
    let rpc: z.infer<typeof rpcResponseSchema>;
    try {
      rpc = rpcResponseSchema.parse(
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

    const { result } = rpc;
    if (result.isError) {
      const message = result.content.map((part) => part.text ?? "").join("\n");
      throw new CliError(
        message,
        isEventNotFound(message) ? ExitCode.NotFound : ExitCode.ServiceError,
      );
    }
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new CliError(
        `The ${name} response does not match the contract this CLI expects. Updating the CLI may fix this.`,
        ExitCode.ServiceError,
      );
    }
    return parsed.data;
  }

  return {
    listEvents: async (
      when: "upcoming" | "past" | "all",
      limit: number,
    ): Promise<EventSummary[]> =>
      (await callTool("list_events", { when, limit }, eventListSchema)).events,
    getEvent: async (slug: string): Promise<Event> => {
      try {
        return await callTool("get_event", { slug }, eventSchema);
      } catch (error) {
        if (error instanceof CliError && error.exitCode === ExitCode.NotFound) {
          throw new CliError(
            `No published event has the slug "${slug}". Run "${commandName} events --all" to find one.`,
            ExitCode.NotFound,
          );
        }
        throw error;
      }
    },
    listSpeakers: async (
      query: string | undefined,
      limit: number,
    ): Promise<Speaker[]> =>
      (
        await callTool(
          "list_speakers",
          query === undefined ? { limit } : { query, limit },
          speakerListSchema,
        )
      ).speakers,
    getCommunity: (): Promise<Community> =>
      callTool("get_community", {}, communitySchema),
  };
}

export type Client = ReturnType<typeof createClient>;
