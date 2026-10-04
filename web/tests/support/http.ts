/** What a test compares of an HTTP answer. */
export interface Answer {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly body: string;
}

export async function answer(response: Response): Promise<Answer> {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    body: await response.text(),
  };
}

/** The headers a Streamable HTTP client sends, as the CLI sends them. */
export const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
} as const;

/** A JSON-RPC request to an MCP endpoint at `url`. */
export function mcpRequest(
  url: string,
  message: unknown,
  headers: Readonly<Record<string, string>> = mcpHeaders,
): Request {
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
}

/** The single JSON-RPC message in an event-stream or JSON body. */
export function rpcMessage(body: string): unknown {
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("");
  return JSON.parse(data === "" ? body : data);
}
