import type { CallToolResult } from "@modelcontextprotocol/server";
import { Context, Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CacheControl } from "../cache.ts";
import { WaitUntil } from "../images/route.ts";
import type { Site } from "../site.ts";
import type { CallTool, ToolName } from "./tools.ts";

/**
 * `/mcp`: the MCP server (server.ts), loaded with a dynamic import the
 * first time an isolate serves it, so its SDK and zod stay out of the code
 * every cold start parses.
 *
 * Its tools read public data, so each call is answered through the page
 * store (web/src/page-store.ts) where the Worker has one: as a GET of
 * {@link toolPath}, whose answer the store keeps by the data's version and
 * time window like any page. A call already answered for this version
 * never reads the database, so Claude sessions calling the tools don't
 * wake Neon. Without a store (tests, previews) a call runs its program.
 */

/** Where a tool's answer is kept: `/_mcp/tools/<name>?input=<its input as JSON>`. */
export const toolPath = "/_mcp/tools";

/** `input` as JSON with its keys in order, so one input is one path. */
export const canonicalInput = (input: Record<string, unknown>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  );

/** The page store in front of the app (worker.ts), when the Worker has one. */
export class ThroughStore extends Context.Reference<
  Option.Option<
    (
      request: Request,
      context: { waitUntil(promise: Promise<unknown>): void },
    ) => Promise<Response>
  >
>("allthings/web/ThroughStore", { defaultValue: () => Option.none() }) {}

const tools = () => import("./tools.ts");

/**
 * The mark on a result that couldn't read the data (tools.ts): it keeps
 * the result out of the store, and clients never see it.
 */
export const transientMark = "allthings/transient";

/** `result` as a client gets it: without the store's mark. */
const unmarked = (result: CallToolResult): CallToolResult => {
  if (result._meta === undefined || !(transientMark in result._meta)) {
    return result;
  }
  const { [transientMark]: _, ...meta } = result._meta;
  const { _meta: __, ...rest } = result;
  return Object.keys(meta).length === 0 ? rest : { ...rest, _meta: meta };
};

export class Mcp extends Context.Service<
  Mcp,
  {
    /** Serves `/mcp`, answering tools through `through` when given. */
    readonly fetch: (
      request: Request,
      through?: (request: Request) => Promise<Response>,
    ) => Promise<Response>;
    /** Runs `name` on the input at {@link toolPath}, as JSON. */
    readonly answer: (name: string, input: string | null) => Promise<Response>;
  }
>()("allthings/web/Mcp") {
  static readonly layer = Layer.effect(
    Mcp,
    Effect.gen(function* () {
      // The isolate's services (Site, config), for running tool programs.
      const context = yield* Effect.context<Site>();
      const run = Effect.runPromiseWith(context);

      /** Runs the tool's program here, reading the database. */
      const direct: CallTool = async (name, input) => {
        const { toolProgram } = await tools();
        const program = toolProgram(name, input);
        return program === undefined
          ? {
              isError: true,
              content: [{ type: "text", text: "Invalid input" }],
            }
          : unmarked(await run(program));
      };

      /** Asks the store for the tool's answer; runs it here if that fails. */
      const via =
        (through: (request: Request) => Promise<Response>): CallTool =>
        async (name, input) => {
          try {
            const response = await through(
              new Request(
                `https://allthings.dev${toolPath}/${name}?input=${encodeURIComponent(canonicalInput(input))}`,
                { headers: { "accept-encoding": "br, gzip" } },
              ),
            );
            if (response.ok) {
              return unmarked((await response.json()) as CallToolResult);
            }
            await response.body?.cancel();
          } catch {
            // Answered here instead.
          }
          return direct(name, input);
        };

      return Mcp.of({
        fetch: async (request, through) => {
          const { mcpHandler } = await import("./server.ts");
          return mcpHandler(through === undefined ? direct : via(through))(
            request,
          );
        },
        answer: async (name, input) => {
          const { isToolName, toolProgram } = await tools();
          let parsed: unknown;
          try {
            parsed = JSON.parse(input ?? "{}");
          } catch {
            parsed = undefined;
          }
          const program = isToolName(name)
            ? toolProgram(name satisfies ToolName, parsed)
            : undefined;
          if (program === undefined) {
            return Response.json(
              { error: "no such tool, or input it refuses" },
              {
                status: 400,
                headers: { "cache-control": CacheControl.failure },
              },
            );
          }
          const result = await run(program);
          // A result that couldn't read the data is never kept.
          const keep = result._meta?.[transientMark] !== true;
          return Response.json(result, {
            headers: {
              "cache-control": keep
                ? CacheControl.publicData
                : CacheControl.failure,
            },
          });
        },
      });
    }),
  );
}

/** `/mcp`, every method: the SDK answers the ones it doesn't serve with 405. */
export const mcpRoute = HttpRouter.add(
  "*",
  "/mcp",
  Effect.gen(function* () {
    const mcp = yield* Mcp;
    const through = yield* ThroughStore;
    const waitUntil = yield* WaitUntil;
    const request = yield* HttpServerRequest.toWeb(
      yield* HttpServerRequest.HttpServerRequest,
    );
    // The SDK's Response passes through untouched, streamed bodies included.
    return HttpServerResponse.raw(
      yield* Effect.promise(() =>
        mcp.fetch(
          request,
          Option.isNone(through)
            ? undefined
            : (inner) => through.value(inner, { waitUntil }),
        ),
      ),
    );
  }),
);

/** A tool's answer, as the store keeps it (see the module's comment). */
export const toolRoute = HttpRouter.add(
  "GET",
  `${toolPath}/:name`,
  Effect.gen(function* () {
    const mcp = yield* Mcp;
    const { name = "" } = yield* HttpRouter.params;
    const { input } = yield* HttpServerRequest.ParsedSearchParams;
    return HttpServerResponse.raw(
      yield* Effect.promise(() =>
        mcp.answer(name, typeof input === "string" ? input : null),
      ),
    );
  }),
);
