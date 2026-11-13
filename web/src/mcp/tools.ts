import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { asOf } from "allthings-core/src/clock.ts";
import * as Coaching from "allthings-core/src/coaching.ts";
import * as Contract from "allthings-core/src/contract.ts";
import type { DataSourceError } from "allthings-core/src/errors.ts";
import { Events } from "allthings-core/src/events.ts";
import { readGuide, toGuide } from "allthings-core/src/guide.ts";
import * as Mappers from "allthings-core/src/mappers.ts";
import { Speakers } from "allthings-core/src/speakers.ts";
import { Year, yearContract } from "allthings-core/src/year.ts";
import { Effect, Option, Schema } from "effect";
import { z } from "zod";
import { type Repositories, repositories } from "../database.ts";
import { mediaOrigin } from "../links.ts";
import { Site } from "../site.ts";
import { community } from "./community.ts";
import { transientMark } from "./endpoint.ts";

/**
 * The public MCP tools, as app/src/lib/mcp/tools.ts declares them: the same
 * names, titles, descriptions, annotations, input schemas and error texts,
 * because agents and the CLI (cli/, `allthings`) rely on them. get_year,
 * a year of our evenings looked back on, and coach_talk are the Worker's
 * own: the app never had them.
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

const goals = Coaching.Goal.literals;

/** coach_talk's text fields: each optional, at most its limit. */
const material = (max: number, description: string) =>
  z.string().max(max).optional().describe(description);

/** The public tools' inputs, as MCP clients send them. */
export const toolInputs = {
  list_events: z.object({
    when: z
      .enum(["upcoming", "past", "all"])
      .default("upcoming")
      .describe("Which events to list."),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  get_event: z.object({
    slug: z.string().min(1).describe("Event slug from list_events."),
  }),
  list_speakers: z.object({
    query: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  get_community: z.object({}),
  get_guide: z.object({}),
  get_year: z.object({
    year: z
      .number()
      .int()
      .min(1000)
      .max(9999)
      .optional()
      .describe(
        "The year, on San Francisco's calendar. Leave it out for the latest year with an evening held.",
      ),
  }),
  coach_talk: z.object({
    format: z
      .enum(Coaching.SlotFormat.literals)
      .default("open-floor")
      .describe(
        "open-floor: a short slot anyone can take at an open floor. talk: a talk in an evening's lineup.",
      ),
    minutes: z
      .number()
      .int()
      .min(1)
      .max(Coaching.maxSlotMinutes)
      .optional()
      .describe(
        `The slot's length in minutes: ${Coaching.defaultMinutes["open-floor"]} for an open floor and ${Coaching.defaultMinutes.talk} for a talk unless given.`,
      ),
    title: material(Coaching.limits.title, "The talk's title."),
    abstract: material(
      Coaching.limits.abstract,
      "The talk's abstract, as people will read it.",
    ),
    outline: material(
      Coaching.limits.outline,
      "An outline or the slides' text. Slides separated by lines of --- are counted as slides.",
    ),
    transcript: material(
      Coaching.limits.transcript,
      "A rehearsal's transcript: plain text, or WebVTT or SRT with timestamps.",
    ),
    goals: z
      .array(z.enum(goals))
      .max(Coaching.limits.goals)
      .optional()
      .describe("What the speaker wants from the talk."),
  }),
} as const;

export type ToolName = keyof typeof toolInputs;

export const isToolName = (name: string): name is ToolName =>
  Object.hasOwn(toolInputs, name);

/**
 * The tools that read public data, whose answers the page store keeps
 * (endpoint.ts). coach_talk reads only what it's sent: its calls never
 * reach the store, so nothing a speaker sends is kept or put in a URL.
 */
export const keptTools: ReadonlySet<ToolName> = new Set([
  "list_events",
  "get_event",
  "list_speakers",
  "get_community",
  "get_guide",
  "get_year",
]);

export const isKeptTool = (name: string): name is ToolName =>
  isToolName(name) && keptTools.has(name);

/**
 * How a tool call is answered: by name, with its input as the tool's schema
 * parsed it. The endpoint answers through the page store (endpoint.ts), so
 * a call already answered for this version of the data never reads it.
 */
export type CallTool = (
  name: ToolName,
  input: Record<string, unknown>,
) => Promise<CallToolResult>;

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
          Effect.as({
            ...fail(
              `allthings ${subject} are temporarily unavailable. Please retry in a minute.`,
            ),
            // Answered, but never kept by the store: the next call reads again.
            _meta: { [transientMark]: true },
          }),
        ),
      ),
    );

const listEvents = (when: Mappers.EventSelection, limit: number) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const rows = yield* Events.use((events) => events.listPublished);
    const now = yield* asOf;
    const events = Mappers.selectEvents(rows, when, now)
      .slice(0, limit)
      .map((row) => Mappers.toEventSummary(row, origin, now));
    return succeed({ events });
  }).pipe(withDataSource("list_events", "events"));

const getEvent = (slug: string) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const row = yield* Events.use((events) => events.getPublished(slug));
    return succeed(yield* Mappers.toEvent(row, origin, yield* asOf));
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

/** The guide as of the clock (core's src/guide.ts): it reads no database. */
const getGuide: ToolProgram = Effect.gen(function* () {
  const { origin } = yield* Site;
  return succeed(toGuide(yield* readGuide, origin));
});

/**
 * A year of our evenings (core's src/year.ts), the latest with one held
 * when none is asked for. A year without one is an answer, not a failure.
 */
const getYear = (asked: number | undefined) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const year = asked ?? (yield* Year.use((years) => years.years)).at(0);
    if (year === undefined) {
      return fail("No allthings evening has been held yet.");
    }
    const found = yield* Year.use((years) => years.read(year, mediaOrigin));
    return Option.match(found, {
      onNone: () => fail(`No allthings evening was held in ${year}.`),
      onSome: (view) => succeed(yearContract(view, origin)),
    });
  }).pipe(withDataSource("get_year", "years"));

/**
 * Coaching for the talk in `input` (core/src/coaching.ts): a pure function
 * of what was sent, which is neither stored nor logged.
 */
const coachTalk = (
  input: z.infer<(typeof toolInputs)["coach_talk"]>,
): ToolProgram =>
  Effect.sync(() =>
    succeed(
      Coaching.coach({
        slot: {
          format: input.format,
          minutes: input.minutes ?? Coaching.defaultMinutes[input.format],
        },
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.abstract === undefined ? {} : { abstract: input.abstract }),
        ...(input.outline === undefined ? {} : { outline: input.outline }),
        ...(input.transcript === undefined
          ? {}
          : { transcript: input.transcript }),
        ...(input.goals === undefined ? {} : { goals: input.goals }),
      }),
    ),
  );

/**
 * The program that answers `name` with `input` (untrusted: it is parsed
 * with the tool's schema first), or undefined for input the tool refuses.
 */
export function toolProgram(
  name: ToolName,
  input: unknown,
): ToolProgram | undefined {
  switch (name) {
    case "list_events": {
      const parsed = toolInputs.list_events.safeParse(input);
      return parsed.success
        ? listEvents(parsed.data.when, parsed.data.limit)
        : undefined;
    }
    case "get_event": {
      const parsed = toolInputs.get_event.safeParse(input);
      return parsed.success ? getEvent(parsed.data.slug) : undefined;
    }
    case "list_speakers": {
      const parsed = toolInputs.list_speakers.safeParse(input);
      return parsed.success
        ? listSpeakers(parsed.data.query, parsed.data.limit)
        : undefined;
    }
    case "get_community":
      return toolInputs.get_community.safeParse(input).success
        ? getCommunity
        : undefined;
    case "get_guide":
      return toolInputs.get_guide.safeParse(input).success
        ? getGuide
        : undefined;
    case "get_year": {
      const parsed = toolInputs.get_year.safeParse(input);
      return parsed.success ? getYear(parsed.data.year) : undefined;
    }
    case "coach_talk": {
      const parsed = toolInputs.coach_talk.safeParse(input);
      return parsed.success ? coachTalk(parsed.data) : undefined;
    }
    default:
      return undefined;
  }
}

/** Registers the public tools on `server`; `call` answers them. */
export function registerTools(server: McpServer, call: CallTool): void {
  server.registerTool(
    "list_events",
    {
      title: "List events",
      description:
        "List allthings events in San Francisco. Upcoming (including live) events come soonest first; past events come most recent first. Registration always happens at each event's rsvpUrl.",
      inputSchema: toolInputs.list_events,
      outputSchema: outputSchema(
        Schema.Struct({ events: Schema.Array(Contract.EventSummary) }),
      ),
      annotations: readOnly,
    },
    (input) => call("list_events", input),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event",
      description:
        "Get one allthings event by slug: schedule, venue, talks with speakers, hosting companies and where to register.",
      inputSchema: toolInputs.get_event,
      outputSchema: outputSchema(Schema.Struct(Contract.Event.fields)),
      annotations: readOnly,
    },
    (input) => call("get_event", input),
  );

  server.registerTool(
    "list_speakers",
    {
      title: "List speakers",
      description:
        "List people who have spoken at past allthings events, with their talks. Optionally filter by a case-insensitive name, title or talk search.",
      inputSchema: toolInputs.list_speakers,
      outputSchema: outputSchema(
        Schema.Struct({ speakers: Schema.Array(Contract.Speaker) }),
      ),
      annotations: readOnly,
    },
    (input) => call("list_speakers", input),
  );

  server.registerTool(
    "get_community",
    {
      title: "About allthings",
      description:
        "What allthings is: mission, history, how hosting works, and links to events, Discord and the code of conduct.",
      inputSchema: toolInputs.get_community,
      outputSchema: outputSchema(Schema.Struct(Contract.Community.fields)),
      annotations: readOnly,
    },
    () => call("get_community", {}),
  );

  server.registerTool(
    "get_guide",
    {
      title: "The allthings guide",
      description:
        "Conferences and happenings beyond allthings' own evenings worth going to, starred as the Michelin guide stars restaurants: 3 stars are worth a special journey, 2 a detour, 1 a stop. Each with its city, why, who runs it, its official site, and its next edition's dates once announced.",
      inputSchema: toolInputs.get_guide,
      outputSchema: outputSchema(Schema.Struct(Contract.Guide.fields)),
      annotations: readOnly,
    },
    () => call("get_guide", {}),
  );

  server.registerTool(
    "get_year",
    {
      title: "Get a year",
      description:
        "A year of allthings evenings, looked back on: every evening of ours held that year in order, with its neighborhood, hosting companies, who was on stage, Luma's guest count and its photo, and the year's tally of evenings, people on stage, hosting companies and guests.",
      inputSchema: toolInputs.get_year,
      outputSchema: outputSchema(Schema.Struct(Contract.Year.fields)),
      annotations: readOnly,
    },
    (input) => call("get_year", input),
  );

  server.registerTool(
    "coach_talk",
    {
      title: "Coach a talk",
      description:
        "Coach a talk for an allthings stage. Send the slot (an open floor is 3 minutes, and the timer is hard) and any of a title, an abstract, an outline or slide text, a rehearsal's transcript (plain, WebVTT or SRT) and goals. Returns findings, most pressing first (must, should, consider), each with what was measured and one line of advice, what's already working, and what more could be checked. The checks are deterministic, and nothing sent is stored or logged.",
      inputSchema: toolInputs.coach_talk,
      outputSchema: outputSchema(Schema.Struct(Coaching.Coaching.fields)),
      annotations: readOnly,
    },
    (input) => call("coach_talk", input),
  );
}
