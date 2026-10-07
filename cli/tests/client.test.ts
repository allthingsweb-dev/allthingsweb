import { describe, expect, test } from "bun:test";
import { createClient, type Fetch } from "../src/client.ts";
import { CliError, ExitCode } from "../src/errors.ts";
import { event, summary } from "./fixtures.ts";

function respondWith(
  body: unknown,
  { status = 200, stream = true }: { status?: number; stream?: boolean } = {},
): { fetch: Fetch; requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    fetch: async (_url, init) => {
      if (typeof init.body !== "string") {
        throw new Error("Expected a JSON string body");
      }
      requests.push(JSON.parse(init.body));
      const json = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        ...(body as object),
      });
      return stream
        ? new Response(`event: message\ndata: ${json}\n\n`, {
            status,
            headers: { "content-type": "text/event-stream" },
          })
        : new Response(json, {
            status,
            headers: { "content-type": "application/json" },
          });
    },
  };
}

async function expectCliError(promise: Promise<unknown>, exitCode: ExitCode) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CliError);
  expect((error as CliError).exitCode).toBe(exitCode);
  return error as CliError;
}

describe("MCP client", () => {
  test("calls tools over JSON-RPC and validates structured results", async () => {
    const { fetch, requests } = respondWith({
      result: { content: [], structuredContent: { events: [summary] } },
    });
    expect(await createClient({ fetch }).listEvents("past", 3)).toEqual([
      summary,
    ]);
    expect(requests[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_events", arguments: { when: "past", limit: 3 } },
    });
  });

  test("reads plain JSON responses too", async () => {
    const { fetch } = respondWith(
      { result: { content: [], structuredContent: event } },
      { stream: false },
    );
    expect(await createClient({ fetch }).getEvent(event.slug)).toEqual(event);
  });

  test("maps a missing event to NotFound and other tool errors to ServiceError", async () => {
    const missing = respondWith({
      result: {
        isError: true,
        content: [
          { type: "text", text: 'No published event has the slug "x".' },
        ],
      },
    });
    const notFound = await expectCliError(
      createClient(missing).getEvent("x"),
      ExitCode.NotFound,
    );
    expect(notFound.message).toBe(
      `No published event has the slug "x". Run "allthings events --all" to find one.`,
    );

    const down = respondWith({
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: "allthings events are temporarily unavailable.",
          },
        ],
      },
    });
    await expectCliError(
      createClient(down).listEvents("upcoming", 1),
      ExitCode.ServiceError,
    );
  });

  test("rejects results that break the contract instead of printing garbage", async () => {
    const { fetch } = respondWith({
      result: { content: [], structuredContent: { events: [{ slug: 1 }] } },
    });
    const error = await expectCliError(
      createClient({ fetch }).listEvents("upcoming", 1),
      ExitCode.ServiceError,
    );
    expect(error.message).toContain("does not match the contract");
  });

  test("reports unreachable servers and HTTP failures as service errors", async () => {
    await expectCliError(
      createClient({
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }).getCommunity(),
      ExitCode.ServiceError,
    );
    await expectCliError(
      createClient(respondWith({}, { status: 502 })).getCommunity(),
      ExitCode.ServiceError,
    );
  });

  test("reports a body that times out as unreachable, not as an unexpected response", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(
          new DOMException("The operation timed out.", "TimeoutError"),
        );
      },
    });
    const error = await expectCliError(
      createClient({
        fetch: async () =>
          new Response(stalled, {
            headers: { "content-type": "text/event-stream" },
          }),
      }).getCommunity(),
      ExitCode.ServiceError,
    );
    expect(error.message).toBe(
      "Could not reach https://allthings.dev/mcp: timed out",
    );
  });
});
