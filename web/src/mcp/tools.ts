import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import * as Contract from "allthings-core/src/contract.ts";
import type { DataSourceError } from "allthings-core/src/errors.ts";
import { Events } from "allthings-core/src/events.ts";
import * as Mappers from "allthings-core/src/mappers.ts";
import { Speakers } from "allthings-core/src/speakers.ts";
import { DateTime, Effect, Schema } from "effect";
import { z } from "zod";
import { type Repositories, repositories } from "../database.ts";
import { Site } from "../site.ts";
import { community } from "./community.ts";

/**
 * The public MCP tools, as app/src/lib/mcp/tools.ts declares them: the same
 * names, titles, descriptions, annotations, input schemas and error texts,
 * because agents and the CLI (cli/, `allthings`) rely on them.
 *
 * Input schemas stay in zod, the MCP SDK's own schema library and so already
 * in the bundle: they are what clients see in tools/list and they word the
 * validation errors, which this keeps byte for byte. Output schemas are
 * core's Effect contract.
 */

/** A tool's work, with every failure already turned into a tool result. */
export type ToolProgram = Effect.Effect<CallToolResult, never, Site>;

/** Runs a tool's program with the isolate's services. */
export type RunTool = (program: ToolProgram) => Promise<CallToolResult>;

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const jsonSchemaDialect = "https://json-schema.org/draft/2020-12/schema";

/**
 * A contract struct as the SDK takes an output schema: Effect validates the
 * structured content, and clients see its JSON Schema with the dialect zod
 * declared. Converting annotates the schema it is given, so callers pass a
 * new struct rather than one of core's.
 */
function outputSchema(
  schema: Schema.Codec<unknown, unknown>,
): StandardSchemaWithJSON<unknown, unknown> {
  const { validate } = Schema.toStandardSchemaV1(schema)["~standard"];
  const { jsonSchema } = Schema.toStandardJSONSchemaV1(schema)["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "effect",
      validate,
      jsonSchema: {
        input: (options) => ({
          $schema: jsonSchemaDialect,
          ...jsonSchema.input(options),
        }),
        output: (options) => ({
          $schema: jsonSchemaDialect,
          ...jsonSchema.output(options),
        }),
      },
    },
  };
}

const json = (value: unknown) => [
  { type: "text" as const, text: JSON.stringify(value, null, 2) },
];

const succeed = (value: Record<string, unknown>): CallToolResult => ({
  content: json(value),
  structuredContent: value,
});

const fail = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text }],
});

/**
 * Runs a tool body against the database. Any failure is logged; clients only
 * see that `subject` is temporarily unavailable, as the app tells them.
 */
const withDataSource =
  (tool: string, subject: string) =>
  (
    body: Effect.Effect<CallToolResult, DataSourceError, Repositories | Site>,
  ): ToolProgram =>
    body.pipe(
      Effect.provide(repositories),
      Effect.catchCause((cause) =>
        Effect.logError(`MCP tool ${tool} failed`, cause).pipe(
          Effect.as(
            fail(
              `all things ${subject} are temporarily unavailable. Please retry in a minute.`,
            ),
          ),
        ),
      ),
    );

const listEvents = (when: Mappers.EventSelection, limit: number) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const rows = yield* Events.use((events) => events.listPublished);
    const now = yield* DateTime.now;
    const events = Mappers.selectEvents(rows, when, now)
      .slice(0, limit)
      .map((row) => Mappers.toEventSummary(row, origin, now));
    return succeed({ events });
  }).pipe(withDataSource("list_events", "events"));

const getEvent = (slug: string) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const row = yield* Events.use((events) => events.getPublished(slug));
    return succeed(yield* Mappers.toEvent(row, origin, yield* DateTime.now));
  }).pipe(
    // Not found is an answer, not a failure: the CLI keys its exit code off it.
    Effect.catchTag("EventNotFound", (error) =>
      Effect.succeed(fail(error.message)),
    ),
    withDataSource("get_event", "event details"),
  );

const listSpeakers = (query: string | undefined, limit: number) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const directory = yield* Speakers.use((speakers) => speakers.directory);
    const needle = query?.toLowerCase();
    const speakers = Mappers.toSpeakers(directory, origin)
      .filter(
        (speaker) =>
          needle === undefined ||
          [
            speaker.name,
            speaker.title ?? "",
            ...speaker.talks.map((t) => t.title),
          ]
            .join("\n")
            .toLowerCase()
            .includes(needle),
      )
      .slice(0, limit);
    return succeed({ speakers });
  }).pipe(withDataSource("list_speakers", "speakers"));

const getCommunity: ToolProgram = Site.useSync(({ origin }) =>
  succeed(community(origin)),
);

/** Registers the four public tools on `server`; `run` executes their programs. */
export function registerTools(server: McpServer, run: RunTool): void {
  server.registerTool(
    "list_events",
    {
      title: "List events",
      description:
        "List all things events in San Francisco. Upcoming (including live) events come soonest first; past events come most recent first. Registration always happens at each event's rsvpUrl.",
      inputSchema: z.object({
        when: z
          .enum(["upcoming", "past", "all"])
          .default("upcoming")
          .describe("Which events to list."),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: outputSchema(
        Schema.Struct({ events: Schema.Array(Contract.EventSummary) }),
      ),
      annotations: readOnly,
    },
    ({ when, limit }) => run(listEvents(when, limit)),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event",
      description:
        "Get one all things event by slug: schedule, venue, talks with speakers, hosting companies and where to register.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Event slug from list_events."),
      }),
      outputSchema: outputSchema(Schema.Struct(Contract.Event.fields)),
      annotations: readOnly,
    },
    ({ slug }) => run(getEvent(slug)),
  );

  server.registerTool(
    "list_speakers",
    {
      title: "List speakers",
      description:
        "List people who have spoken at past all things events, with their talks. Optionally filter by a case-insensitive name, title or talk search.",
      inputSchema: z.object({
        query: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      outputSchema: outputSchema(
        Schema.Struct({ speakers: Schema.Array(Contract.Speaker) }),
      ),
      annotations: readOnly,
    },
    ({ query, limit }) => run(listSpeakers(query, limit)),
  );

  server.registerTool(
    "get_community",
    {
      title: "About all things",
      description:
        "What all things is: mission, history, how hosting works, and links to events, Discord and the code of conduct.",
      inputSchema: z.object({}),
      outputSchema: outputSchema(Schema.Struct(Contract.Community.fields)),
      annotations: readOnly,
    },
    () => run(getCommunity),
  );
}
