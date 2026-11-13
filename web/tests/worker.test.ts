import { describe, expect } from "bun:test";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { Guide } from "allthings-core/src/contract.ts";
import { guideEntries } from "allthings-core/src/guide.ts";
import {
  everyIssue,
  publishedLetters,
  toLetter,
  toLetters,
} from "allthings-core/src/letter.ts";
import { seededDatabase } from "allthings-core/tests/support/database.ts";
import * as Contract from "allthings-core/src/contract.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { coach } from "allthings-core/src/coaching.ts";
import { CacheControl } from "../src/cache.ts";
import { maxRequestBodySize, maxToolInputElements } from "../src/mcp/server.ts";
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
import { built } from "../src/assets.ts";
import { buildId } from "../src/build-id.ts";
import { budgetProblems, startupContributors } from "./support/bundle.ts";
import { bundleBudgets, hyperdriveTo, testStack } from "./support/stack.ts";

/**
 * The Worker, bundled as it deploys and running in workerd, against the app
 * it replaced. It reads the production schema (core's migrations) with
 * core's seed, in PGlite, over TCP with @effect/sql-pg through its
 * Hyperdrive binding, as it deploys. The app answered the same database;
 * its answers are recorded (support/app.ts).
 *
 * The app is legacy and no longer the reference for the contract: it never
 * says whose an evening is (`curation`, `organizer`). The Worker's MCP
 * answers are compared with it on every other field; core's contract and
 * web/tests/parity.test.ts hold the rest.
 */

const origin = "https://allthingsweb.dev";

const db = await seededDatabase();
const postgres = new PGLiteSocketServer({ db, port: 0, maxConnections: 8 });
await postgres.start();
const app = await loadApp(db);

const Stack = testStack("allthings-web-test", {
  Web: {
    ORIGIN: origin,
    HYPERDRIVE: hyperdriveTo(
      `postgres://postgres:postgres@${postgres.getServerConn()}/postgres`,
    ),
  },
  // Nothing listens on the discard port, so every connection is refused.
  Unreachable: {
    ORIGIN: origin,
    HYPERDRIVE: hyperdriveTo(
      "postgres://postgres:postgres@127.0.0.1:9/postgres",
    ),
  },
  Unconfigured: { ORIGIN: origin },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
// The database server stops even if tearing the stack down fails.
afterAll(
  destroy(Stack).pipe(
    Effect.ensuring(
      Effect.promise(async () => {
        await postgres.stop();
        await db.close();
      }),
    ),
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
  const expected = app.v1(path);
  return [await answer(await fetch(new URL(path, url))), expected];
}

/** The Worker's MCP answer, next to the app's. */
async function mcp(
  url: string,
  message: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<[Answer, Answer]> {
  const expected = app.mcp(
    "POST",
    headers ?? mcpHeaders,
    JSON.stringify(message),
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

/** The fields the contract has and the legacy app never had. */
const sinceTheApp = ["curation", "organizer"];

/** Where an event's page is: the contract names allthings.dev, the legacy app its own host. */
const eventPage = {
  contract: "Event page on allthings.dev, at its short link when it has one.",
  app: "Event page on allthingsweb.dev.",
};

/** JSON Schema `schema` without {@link sinceTheApp}'s properties. */
function schemaAsTheAppHasIt(schema: Json): Json {
  if (Array.isArray(schema)) return schema.map(schemaAsTheAppHasIt);
  if (schema === null || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      if (key === "properties" && value !== null && typeof value === "object") {
        return [
          key,
          schemaAsTheAppHasIt(
            Object.fromEntries(
              Object.entries(value).filter(
                ([property]) => !sinceTheApp.includes(property),
              ),
            ),
          ),
        ];
      }
      if (key === "description" && value === eventPage.contract)
        return [key, eventPage.app];
      if (key === "required" && Array.isArray(value)) {
        return [
          key,
          value.filter(
            (property) =>
              typeof property !== "string" || !sinceTheApp.includes(property),
          ),
        ];
      }
      return [key, schemaAsTheAppHasIt(value)];
    }),
  );
}

/** `value` without {@link sinceTheApp}, wherever an event is in it. */
function asTheAppHasIt(value: Json): Json {
  if (Array.isArray(value)) return value.map(asTheAppHasIt);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sinceTheApp.includes(key))
      .map(([key, field]) => [key, asTheAppHasIt(field)]),
  );
}

/**
 * A tools/call answer, an event's attached lists in canonical order, its
 * content shaped by `shape` (in its JSON text too).
 */
function toolAnswer(
  body: string,
  shape: (value: Json) => Json = (value) => value,
): unknown {
  const message = rpcMessage(body) as ToolMessage;
  const result = message.result;
  if (result?.structuredContent === undefined) return message;
  return {
    ...message,
    result: {
      ...result,
      structuredContent: shape(ignoringAttachOrder(result.structuredContent)),
      content: result.content?.map((part) => ({
        ...part,
        text: JSON.stringify(
          shape(ignoringAttachOrder(JSON.parse(part.text) as Json)),
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
    expect(event.previewImage.url).toBe(
      "https://storage.example/covers/react.png",
    );
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
      ["Acme", "https://storage.example/logos/acme.png"],
    ]);
    expect(event.images.map((image) => image.alt)).toEqual([
      "The stage",
      "The crowd",
    ]);
  });

  it("lists the years with an evening of ours held, and answers each as get_year does", async ({
    Web,
  }) => {
    const list = await fetch(`${Web}/api/v1/years`);
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(await list.json()).toEqual({ years: [2026, 2025] });
    const response = await fetch(`${Web}/api/v1/years/2025`);
    expect(response.status).toBe(200);
    const { year } = (await response.json()) as { year: unknown };
    const decoded = Schema.decodeUnknownSync(Contract.Year)(year);
    expect(decoded.evenings.map((evening) => evening.slug)).toEqual([
      "2025-12-02-café-night",
    ]);
    const tool = rpcMessage(
      await (
        await fetch(mcpRequest(`${Web}/mcp`, call("get_year", { year: 2025 })))
      ).text(),
    ) as { result: { structuredContent: unknown } };
    expect(year).toEqual(tool.result.structuredContent);
    for (const path of ["/api/v1/years/2024", "/api/v1/years/25"]) {
      const missing = await fetch(`${Web}${path}`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "Year not found" });
      expect(missing.headers.get("cache-control")).toBe(CacheControl.notFound);
    }
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

  it("GET /api/v1/guide answers the guide, as get_guide does, with no database", async ({
    Web,
    Unconfigured,
  }) => {
    const response = await fetch(`${Web}/api/v1/guide`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    const body = await response.json();
    const guide = Schema.decodeUnknownSync(Guide)(body);
    expect(guide.url).toBe(`${origin}/guide`);
    expect(new Set(guide.entries.map((entry) => entry.id))).toEqual(
      new Set(guideEntries.map((entry) => entry.id)),
    );
    for (const entry of guide.entries) {
      expect(entry.guideUrl).toBe(`${origin}/guide#${entry.id}`);
    }
    const tool = await fetch(mcpRequest(`${Web}/mcp`, call("get_guide", {})));
    const { result } = rpcMessage(await tool.text()) as {
      result: { structuredContent: unknown };
    };
    expect(result.structuredContent).toEqual(body);
    const bare = await fetch(`${Unconfigured}/api/v1/guide`);
    expect(bare.status).toBe(200);
    expect(await bare.json()).toEqual(body);
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
    // The server introduces itself by the new name.
    expect(
      (rpcMessage(actual.body) as { result: { serverInfo: { name: string } } })
        .result.serverInfo.name,
    ).toBe("allthings");
  });

  it("lists the same tools, with the same input and output schemas, then get_letter and coach_talk", async ({
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
    const all = tools(actual.body);
    const today = tools(expected.body);
    expect(all.map((tool) => tool["name"])).toEqual([
      "list_events",
      "get_event",
      "list_speakers",
      "get_community",
      "get_guide",
      "get_year",
      "get_letter",
      "coach_talk",
      "propose_talk",
    ]);
    // get_guide, get_year, get_letter, coach_talk and propose_talk are new:
    // the app never had them (core's contract holds the first three;
    // web/tests/coach-tool.test.ts, coach_talk; web/tests/propose-tool.test.ts,
    // propose_talk).
    const newTools = [
      "get_guide",
      "get_year",
      "get_letter",
      "coach_talk",
      "propose_talk",
    ];
    const served = all.filter(
      (tool) => !newTools.includes(String(tool["name"])),
    );
    // Names, titles, descriptions, annotations and input schemas, exactly,
    // but for one deliberate difference: the Worker writes the name as one
    // word, allthings, where the app still writes "all things".
    const withoutOutput = ({ outputSchema: _, ...tool }: Tool) => tool;
    const todayText = JSON.stringify(today.map(withoutOutput));
    expect(todayText).toContain("all things");
    expect(served.map(withoutOutput)).toEqual(
      JSON.parse(todayText.replaceAll("all things", "allthings")),
    );
    // They name the community as allthings, never by an old name.
    expect(JSON.stringify(served.map(withoutOutput))).not.toMatch(
      /all things/i,
    );
    // Output schemas come from core's Effect contract: the same JSON Schema
    // as the app's, as core's contract test defines sameness, but for the
    // fields the app never had. An event's page is described on allthings.dev,
    // where the app names its own host.
    expect(
      served.map((tool) =>
        schemaAsTheAppHasIt(normalizeJsonSchema(tool.outputSchema)),
      ),
    ).toEqual(today.map((tool) => normalizeJsonSchema(tool.outputSchema)));
    expect(JSON.stringify(served[0]?.outputSchema)).toContain('"curation"');
    expect(JSON.stringify(served.map((tool) => tool.outputSchema))).toContain(
      eventPage.contract,
    );
    expect(
      JSON.stringify(served.map((tool) => tool.outputSchema)),
    ).not.toContain("allthingsweb.dev");
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
      expect(toolAnswer(actual.body, asTheAppHasIt)).toEqual(
        toolAnswer(expected.body),
      );
    });
  }

  // The one deliberate difference: get_community describes allthings by its
  // name and its two sentences, where the app still says All Things Web.
  it("get_community names allthings, and otherwise answers as the app does", async ({
    Web,
  }) => {
    const [actual, expected] = await mcp(Web, call("get_community", {}));
    expect(actual.status).toBe(expected.status);
    expect(actual.contentType).toBe(expected.contentType);
    const appAnswer = toolAnswer(expected.body) as {
      result: {
        structuredContent: {
          mission: string;
          links: Record<string, string>;
        };
        content: ReadonlyArray<{ text: string }>;
      };
    };
    const { mission } = appAnswer.result.structuredContent;
    expect(mission).toStartWith("All Things Web brings ");
    const rebranded = {
      ...appAnswer.result.structuredContent,
      name: "allthings",
      oneLiner:
        "Evenings for people who build software. In the neighborhoods of San Francisco.",
      mission: mission.replace("All Things Web brings ", "allthings brings "),
      // The calendar moved from luma.com/allthingsweb on 2026-11-04.
      links: {
        ...appAnswer.result.structuredContent.links,
        events: "https://luma.com/allthings",
      },
    };
    expect(toolAnswer(actual.body)).toEqual({
      ...appAnswer,
      result: {
        ...appAnswer.result,
        structuredContent: rebranded,
        content: appAnswer.result.content.map((part) => ({
          ...part,
          text: JSON.stringify(rebranded, null, 2),
        })),
      },
    });
    expect(actual.body).not.toMatch(/all things/i);
  });

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

  it("coaches a talk with no database, its answer matching its output schema", async ({
    Unconfigured,
  }) => {
    const transcript = [
      "WEBVTT",
      "",
      "00:00.000 --> 00:10.000",
      "Hi, I'm Sam, and I built a queue.",
      "",
      "00:10.000 --> 03:20.000",
      "Book a demo, it's 20% off this week.",
    ].join("\n");
    const response = await fetch(
      mcpRequest(
        `${Unconfigured}/mcp`,
        call("coach_talk", { title: "A queue", transcript }),
      ),
    );
    const { result } = rpcMessage(await response.text()) as {
      result: {
        isError?: boolean;
        structuredContent: unknown;
      };
    };
    // The SDK checks structured content against the output schema, and
    // answers an error when they differ.
    expect(result.isError).toBeUndefined();
    const coaching = coach({
      slot: { format: "open-floor", minutes: 3 },
      title: "A queue",
      transcript,
    });
    expect(result.structuredContent).toEqual(coaching);
    expect(coaching.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["length", "no-pitch"]),
    );
  });

  /**
   * Headers for a request the Worker answers before reading its whole body.
   * workerd then closes the connection rather than read the rest, but Bun's
   * fetch keeps it for the next request, which is reset when it goes out
   * on it (ECONNRESET, with no answer). Closing it with the exchange keeps
   * the next request on a fresh connection.
   */
  const refusedHeaders = { ...mcpHeaders, connection: "close" };

  it("refuses a body over its size limit before reading it", async ({
    Web,
  }) => {
    const response = await fetch(
      mcpRequest(
        `${Web}/mcp`,
        call("get_event", { slug: "x".repeat(maxRequestBodySize) }),
        refusedHeaders,
      ),
    );
    await response.body?.cancel();
    expect(response.status).toBe(413);
  });

  it("refuses a streamed body once it has read past its size limit", async ({
    Web,
  }) => {
    // No Content-Length: the limit holds on the bytes as they arrive.
    const text = JSON.stringify(
      call("get_event", { slug: "x".repeat(maxRequestBodySize) }),
    );
    const chunk = 4096;
    const bytes = new TextEncoder().encode(text);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(sent, sent + chunk));
        sent += chunk;
      },
    });
    const request = new Request(`${Web}/mcp`, {
      method: "POST",
      headers: refusedHeaders,
      body,
    });
    expect(request.headers.get("content-length")).toBeNull();
    const response = await fetch(request);
    await response.body?.cancel();
    expect(response.status).toBe(413);
  });

  it("serves only the letters Erik approved, from /api/v1/letters as get_letter does", async ({
    Web,
  }) => {
    const published = await Effect.runPromise(publishedLetters);
    const list = await fetch(`${Web}/api/v1/letters`);
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe(CacheControl.publicData);
    const body = Schema.decodeUnknownSync(Contract.Letters)(await list.json());
    expect(body).toEqual(toLetters(published, origin));
    const ask = async (args: Record<string, unknown>) =>
      (
        rpcMessage(
          await (
            await fetch(mcpRequest(`${Web}/mcp`, call("get_letter", args)))
          ).text(),
        ) as {
          result: {
            isError?: boolean;
            structuredContent?: unknown;
            content: Array<{ text: string }>;
          };
        }
      ).result;
    const latest = await ask({});
    if (published[0] === undefined) {
      expect(latest.isError).toBe(true);
      expect(latest.content[0]?.text).toBe(
        "No allthings letter has been published yet.",
      );
    } else {
      expect(latest.structuredContent).toEqual(toLetter(published[0], origin));
    }
    // A month without a published issue is not found, whether or not a
    // draft is written for it.
    const drafts = everyIssue
      .map((issue) => issue.month)
      .filter((month) => !published.some((letter) => letter.month === month));
    for (const month of ["1999-01", ...drafts]) {
      const missing = await fetch(`${Web}/api/v1/letters/${month}`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "Letter not found" });
      const none = await ask({ month });
      expect(none.isError).toBe(true);
      expect(none.content[0]?.text).toBe(
        `No allthings letter was published for ${month}.`,
      );
    }
    expect((await ask({ month: "2026-13" })).isError).toBe(true);
  });

  it("get_year looks back on a year of our evenings in the contract's shape, the latest when none is asked for", async ({
    Web,
  }) => {
    type YearAnswer = {
      result: {
        isError?: boolean;
        structuredContent?: Contract.Year;
        content: Array<{ text: string }>;
      };
    };
    const ask = async (args: Record<string, unknown>) =>
      (
        rpcMessage(
          await (
            await fetch(mcpRequest(`${Web}/mcp`, call("get_year", args)))
          ).text(),
        ) as YearAnswer
      ).result;
    const latest = await ask({});
    expect(latest.isError).toBeUndefined();
    const year = Schema.decodeUnknownSync(Contract.Year)(
      latest.structuredContent,
    );
    expect(year.year).toBe(2026);
    expect(year.years).toEqual([2026, 2025]);
    expect(year.url).toBe(`${origin}/year/2026`);
    // In the order held; the Worker reads the seed at today's clock, when
    // every evening of it is over. The draft is never one.
    expect(year.evenings.map((evening) => evening.slug)).toEqual([
      "2026-08-12-react-at-acme",
      "2026-10-03-ends-now",
      "2026-10-03-hack-day",
      "2026-11-05-upcoming",
    ]);
    expect(year.evenings[0]?.onStage[0]).toEqual({
      name: "Linus",
      url: `${origin}/people/linus`,
    });
    expect(year.tally.guests).toBe(118);
    expect((await ask({ year: 2025 })).structuredContent?.year).toBe(2025);
    const none = await ask({ year: 2024 });
    expect(none.isError).toBe(true);
    expect(none.content[0]?.text).toBe(
      "No allthings evening was held in 2024.",
    );
    expect((await ask({ year: 26 })).isError).toBe(true);
  });

  it("answers a call whose arguments hold too many elements with an error, and still serves", async ({
    Web,
  }) => {
    const elements = Object.fromEntries(
      Array.from({ length: maxToolInputElements + 1 }, (_, i) => [`k${i}`, i]),
    );
    const refused = rpcMessage(
      await (
        await fetch(mcpRequest(`${Web}/mcp`, call("list_events", elements)))
      ).text(),
    ) as { result: { isError?: boolean } };
    expect(refused.result.isError).toBe(true);
    const served = rpcMessage(
      await (
        await fetch(mcpRequest(`${Web}/mcp`, call("get_community", {})))
      ).text(),
    ) as { result: { isError?: boolean } };
    expect(served.result.isError).toBeUndefined();
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
      const expected = app.mcp(
        method,
        headers,
        message === undefined ? null : JSON.stringify(message),
      );
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
                text: `allthings ${subject} are temporarily unavailable. Please retry in a minute.`,
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
      call("get_guide", {}),
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
  it("stays within its budgets", async () => {
    // Where Alchemy writes the bundle it uploads, for the Worker named Web.
    const problems = await budgetProblems(
      new URL("../.alchemy/bundles/Web", import.meta.url).pathname,
      bundleBudgets,
    );
    expect(problems).toBeUndefined();
  });

  it("starts from the build's id alone, never the whole manifest", async () => {
    expect(buildId).toBe(built.build);
    const startup = await startupContributors(
      new URL("../.alchemy/bundles/Web", import.meta.url).pathname,
    );
    const names = startup.map((contributor) => contributor.name);
    expect(names).toContain("src/build-id.ts");
    expect(names).not.toContain("src/assets.ts");
  });
});
