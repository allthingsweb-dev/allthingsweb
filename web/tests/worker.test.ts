import { describe, expect } from "bun:test";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { seededDatabase } from "allthings-core/tests/support/database.ts";
import * as Effect from "effect/Effect";
import { CacheControl } from "../src/cache.ts";
import { loadApp } from "./support/app.ts";
import {
  type Answer,
  answer,
  mcpHeaders,
  mcpRequest,
  rpcMessage,
} from "./support/http.ts";
import { normalizeJsonSchema } from "./support/json-schema.ts";
import { ignoringAttachOrder, type Json } from "./support/order.ts";
import { testStack } from "./support/stack.ts";

/**
 * The Worker, bundled as it deploys and running in workerd, against the app
 * it replaces. Both read one database: the production schema (the app's
 * migrations) with core's seed, in PGlite. The app reads it in process; the
 * Worker connects over TCP with @effect/sql-pg, as it will to Hyperdrive.
 */

const origin = "https://allthingsweb.dev";
const storageOrigin = "https://storage.example";

const db = await seededDatabase();
const postgres = new PGLiteSocketServer({ db, port: 0, maxConnections: 8 });
await postgres.start();
const app = await loadApp(db, { origin, storageOrigin });

const Stack = testStack({
  Web: {
    ORIGIN: origin,
    DATABASE_URL: `postgres://postgres:postgres@${postgres.getServerConn()}/postgres`,
    LEGACY_MEDIA_ORIGIN: storageOrigin,
  },
  // Nothing listens on the discard port, so every connection is refused.
  Unreachable: {
    ORIGIN: origin,
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:9/postgres",
  },
  Unconfigured: { ORIGIN: origin },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(
    Effect.andThen(Effect.promise(() => postgres.stop())),
    Effect.andThen(Effect.promise(() => db.close())),
  ),
);

interface Workers {
  readonly Web: string;
  readonly Unreachable: string;
  readonly Unconfigured: string;
}

/** The running Workers' URLs, from the stack's outputs. */
function urlsOf(outputs: Readonly<Record<string, unknown>>): Workers {
  const url = (name: keyof Workers) => {
    const value = outputs[name];
    if (typeof value !== "string" || !value.startsWith("http://localhost")) {
      throw new Error(`${name} is not running locally: ${String(value)}`);
    }
    return value;
  };
  return {
    Web: url("Web"),
    Unreachable: url("Unreachable"),
    Unconfigured: url("Unconfigured"),
  };
}

/** A test that gets the running Workers' URLs. */
const it = (name: string, run: (urls: Workers) => Promise<void>) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => run(urlsOf(outputs))),
    ),
  );

/** The Worker's answer to a GET, next to the app's. */
async function get(url: string, path: string): Promise<[Answer, Answer]> {
  // The app first: it shares the database, and the two never query at once.
  const expected = await answer(await app.v1(path));
  return [await answer(await fetch(new URL(path, url))), expected];
}

/** The Worker's MCP answer, next to the app's. */
async function mcp(
  url: string,
  message: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<[Answer, Answer]> {
  const expected = await answer(
    await app.mcp(mcpRequest(`${origin}/mcp`, message, headers)),
  );
  return [
    await answer(await fetch(mcpRequest(`${url}/mcp`, message, headers))),
    expected,
  ];
}

/** A v1 body's JSON text, an event's attached lists in canonical order. */
function v1Body(body: string): string {
  const json = JSON.parse(body) as Record<string, Json>;
  const event = json["event"];
  return JSON.stringify(
    event === undefined ? json : { ...json, event: ignoringAttachOrder(event) },
  );
}

type ToolMessage = {
  readonly result?: {
    readonly structuredContent?: Json;
    readonly content?: ReadonlyArray<{ readonly text: string }>;
  };
};

/** A tools/call answer, an event's attached lists in canonical order. */
function toolAnswer(body: string): unknown {
  const message = rpcMessage(body) as ToolMessage;
  const result = message.result;
  if (result?.structuredContent === undefined) return message;
  return {
    ...message,
    result: {
      ...result,
      structuredContent: ignoringAttachOrder(result.structuredContent),
      content: result.content?.map((part) => ({
        ...part,
        text: JSON.stringify(
          ignoringAttachOrder(JSON.parse(part.text) as Json),
          null,
          2,
        ),
      })),
    },
  };
}

const call = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

const eventIds = Array.from(
  { length: 6 },
  (_, i) => `e0000000-0000-4000-8000-00000000000${i + 1}`,
);

describe("v1 API", () => {
  for (const path of [
    "/api/v1/events",
    "/api/v1/speakers",
    ...eventIds.map((id) => `/api/v1/events/${id}`),
    // A published event and the draft, by forms of their ids Postgres reads.
    "/api/v1/events/E0000000-0000-4000-8000-000000000001",
    `/api/v1/events/${eventIds[0]?.replaceAll("-", "")}`,
    "/api/v1/events/%7Be0000000-0000-4000-8000-000000000006%7D",
    "/api/v1/events/e000-0000-0000-4000-8000-0000-0000-0002",
    // Well-formed, but no event has it.
    "/api/v1/events/e0000000-0000-4000-8000-0000000000ff",
  ]) {
    it(`GET ${path} answers as the app does`, async ({ Web }) => {
      const [actual, expected] = await get(Web, path);
      expect(actual.status).toBe(expected.status);
      // NextResponse.json's type, as production sends it. Bun, which runs
      // the app here, adds a charset.
      expect(actual.contentType).toBe("application/json");
      expect(expected.contentType).toStartWith("application/json");
      expect(v1Body(actual.body)).toBe(v1Body(expected.body));
    });
  }

  it("answers a published event with its talks, hosts and photos", async ({
    Web,
  }) => {
    const response = await fetch(`${Web}/api/v1/events/${eventIds[0]}`);
    const { event } = (await response.json()) as {
      event: {
        slug: string;
        previewImage: { url: string };
        talks: Array<{ title: string; speakers: Array<{ name: string }> }>;
        hosts: Array<{ name: string; squareLogoDark: { url: string } }>;
        images: Array<{ alt: string }>;
      };
    };
    expect(event.slug).toBe("2026-08-12-react-at-acme");
    expect(event.previewImage.url).toBe("/media/covers/react.png");
    // Attach order: the join row's created_at.
    expect(event.talks.map((talk) => talk.title)).toEqual([
      "Effect in production",
      "Server components",
    ]);
    expect(event.talks[1]?.speakers.map((speaker) => speaker.name)).toEqual([
      "Grace Hopper",
      "Ada Lovelace",
    ]);
    // Acme only has a light logo, which stands in for the dark one.
    expect(
      event.hosts.map((host) => [host.name, host.squareLogoDark.url]),
    ).toEqual([
      ["Globex", "/brand/avatar.png"],
      ["Acme", "/media/logos/acme.png"],
    ]);
    expect(event.images.map((image) => image.alt)).toEqual([
      "The stage",
      "The crowd",
    ]);
  });

  for (const id of [
    "not-a-uuid",
    "2026-08-12-react-at-acme",
    "e0000000-0000-4000-8000-00000000000",
    "{e0000000-0000-4000-8000-000000000001",
  ]) {
    // The one deliberate difference. The app passes these to Postgres, whose
    // uuid cast fails the whole query, and answers 500. No event can have
    // them, so the Worker answers 404 without a query.
    it(`GET /api/v1/events/${id} is not found, where the app failed`, async ({
      Web,
    }) => {
      const path = `/api/v1/events/${encodeURIComponent(id)}`;
      const [actual, expected] = await get(Web, path);
      expect(expected.status).toBe(500);
      expect(JSON.parse(expected.body)).toEqual({
        error: "Failed to fetch event",
      });
      expect(actual.status).toBe(404);
      expect(JSON.parse(actual.body)).toEqual({ error: "Event not found" });
      expect(actual.cacheControl).toBe(CacheControl.notFound);
    });
  }

  it("lets caches keep public data briefly, and never failures", async ({
    Web,
    Unreachable,
  }) => {
    for (const path of ["/api/v1/events", "/api/v1/speakers"]) {
      const response = await fetch(`${Web}${path}`);
      expect(response.headers.get("cache-control")).toBe(
        CacheControl.publicData,
      );
      const failed = await fetch(`${Unreachable}${path}`);
      expect(failed.headers.get("cache-control")).toBe(CacheControl.failure);
    }
  });

  for (const [path, error] of [
    ["/api/v1/events", "Failed to fetch events"],
    [`/api/v1/events/${eventIds[0]}`, "Failed to fetch event"],
    ["/api/v1/speakers", "Failed to fetch speakers"],
  ] as const) {
    it(`GET ${path} fails as the app does without a database`, async ({
      Unreachable,
      Unconfigured,
    }) => {
      for (const url of [Unreachable, Unconfigured]) {
        const response = await fetch(`${url}${path}`);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error });
      }
    });
  }
});

describe("MCP", () => {
  it("initializes as the app does", async ({ Web }) => {
    const [actual, expected] = await mcp(Web, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    expect(actual).toEqual(expected);
  });

  it("lists the same tools, with the same input and output schemas", async ({
    Web,
  }) => {
    const [actual, expected] = await mcp(Web, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(actual.status).toBe(expected.status);
    type Tool = { outputSchema: unknown } & Record<string, unknown>;
    const tools = (body: string) =>
      (rpcMessage(body) as { result: { tools: Array<Tool> } }).result.tools;
    const served = tools(actual.body);
    const today = tools(expected.body);
    expect(served.map((tool) => tool["name"])).toEqual([
      "list_events",
      "get_event",
      "list_speakers",
      "get_community",
    ]);
    // Names, titles, descriptions, annotations and input schemas, exactly.
    const withoutOutput = ({ outputSchema: _, ...tool }: Tool) => tool;
    expect(served.map(withoutOutput)).toEqual(today.map(withoutOutput));
    // Output schemas come from core's Effect contract: the same JSON Schema,
    // as core's contract test defines sameness.
    expect(
      served.map((tool) => normalizeJsonSchema(tool.outputSchema)),
    ).toEqual(today.map((tool) => normalizeJsonSchema(tool.outputSchema)));
  });

  const calls: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["list_events", {}],
    ["list_events", { when: "upcoming", limit: 100 }],
    ["list_events", { when: "past", limit: 100 }],
    ["list_events", { when: "all", limit: 100 }],
    ["list_events", { when: "all", limit: 2 }],
    ["get_event", { slug: "2026-08-12-react-at-acme" }],
    ["get_event", { slug: "2026-10-03-hack-day" }],
    ["get_event", { slug: "2026-11-05-upcoming" }],
    ["get_event", { slug: "2026-10-03-ends-now" }],
    ["get_event", { slug: "2025-12-02-café-night" }],
    ["get_event", { slug: "2026-09-01-draft-night" }],
    ["get_event", { slug: "no-such-event" }],
    ["get_event", { slug: "2026-08-12-REACT-AT-ACME" }],
    ["list_speakers", {}],
    ["list_speakers", { query: "  ADA " }],
    ["list_speakers", { query: "server components" }],
    ["list_speakers", { query: "nobody" }],
    ["list_speakers", { limit: 1 }],
    ["get_community", {}],
    // Invalid arguments: the zod schemas word these errors.
    ["list_events", { limit: 0 }],
    ["list_events", { when: "tomorrow" }],
    ["get_event", {}],
    ["get_event", { slug: "" }],
    ["list_speakers", { query: "   " }],
    ["list_speakers", { limit: 201 }],
    ["no_such_tool", {}],
  ];

  for (const [name, args] of calls) {
    it(`${name} ${JSON.stringify(args)} answers as the app does`, async ({
      Web,
    }) => {
      const [actual, expected] = await mcp(Web, call(name, args));
      expect(actual.status).toBe(expected.status);
      expect(actual.contentType).toBe(expected.contentType);
      expect(toolAnswer(actual.body)).toEqual(toolAnswer(expected.body));
    });
  }

  it("answers clients that skip initialize, as the CLI does", async ({
    Web,
  }) => {
    const response = await fetch(
      mcpRequest(`${Web}/mcp`, call("list_events", { when: "all" })),
    );
    const message = rpcMessage(await response.text()) as {
      result: { structuredContent: { events: Array<unknown> } };
    };
    expect(message.result.structuredContent.events).toHaveLength(5);
  });

  for (const [label, method, headers, message] of [
    ["GET", "GET", mcpHeaders, undefined],
    ["DELETE", "DELETE", mcpHeaders, undefined],
    [
      "a notification",
      "POST",
      mcpHeaders,
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ],
    [
      "a client that can't read event streams",
      "POST",
      { ...mcpHeaders, accept: "application/json" },
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ],
    [
      "a body that isn't JSON",
      "POST",
      { ...mcpHeaders, "content-type": "text/plain" },
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ],
  ] as const) {
    it(`answers ${label} as the app does`, async ({ Web }) => {
      const init = (url: string) =>
        new Request(url, {
          method,
          headers,
          ...(message === undefined ? {} : { body: JSON.stringify(message) }),
        });
      const expected = await answer(await app.mcp(init(`${origin}/mcp`)));
      const actual = await answer(await fetch(init(`${Web}/mcp`)));
      expect(actual.status).toBe(expected.status);
      expect(actual.body).toBe(expected.body);
    });
  }

  for (const [name, args, subject] of [
    ["list_events", {}, "events"],
    ["get_event", { slug: "2026-08-12-react-at-acme" }, "event details"],
    ["list_speakers", {}, "speakers"],
  ] as const) {
    it(`${name} is temporarily unavailable without a database`, async ({
      Unreachable,
      Unconfigured,
    }) => {
      for (const url of [Unreachable, Unconfigured]) {
        const response = await fetch(
          mcpRequest(`${url}/mcp`, call(name, args)),
        );
        expect(rpcMessage(await response.text())).toEqual({
          jsonrpc: "2.0",
          id: 1,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `All Things Web ${subject} are temporarily unavailable. Please retry in a minute.`,
              },
            ],
          },
        });
      }
    });
  }

  it("needs no database to initialize, list tools or describe the community", async ({
    Unconfigured,
  }) => {
    for (const message of [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      call("get_community", {}),
    ]) {
      const response = await fetch(mcpRequest(`${Unconfigured}/mcp`, message));
      const { result } = rpcMessage(await response.text()) as {
        result: { isError?: boolean };
      };
      expect(result.isError).toBeUndefined();
    }
  });
});

describe("bundle", () => {
  // Today: about 950 KB, 274 KB gzipped. Effect is a third of it, the MCP
  // SDK and the zod it brings another third, and sanitize-html (with
  // postcss) and @effect/sql-pg most of the rest. Raise the budget only on
  // purpose; every byte is parsed on a cold start.
  const budget = 300_000;

  it(`gzips to at most ${budget} bytes`, async () => {
    // Where Alchemy writes the bundle it uploads, for the Worker named Web.
    const bundle = Bun.file(
      new URL("../.alchemy/bundles/Web/worker.js", import.meta.url),
    );
    const size = Bun.gzipSync(await bundle.bytes(), { level: 9 }).byteLength;
    expect(size).toBeLessThanOrEqual(budget);
  });
});
