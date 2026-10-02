import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Event } from "@/lib/events";
import type { ExpandedEvent } from "@/lib/expanded-events";
import {
  eventStatus,
  toPublicCommunity,
  toPublicEvent,
  toPublicEventSummary,
  toPublicSpeakers,
  type SpeakerDirectory,
} from "@/lib/public-api/mappers";
import {
  communitySchema,
  eventSchema,
  eventSummarySchema,
  speakerSchema,
} from "@/lib/public-api/schemas";
import { eventNotFoundMessage } from "@/lib/public-api/errors";

export type AtwMcpDependencies = {
  origin: string;
  now: () => Date;
  /** Published events only; drafts must never be returned. */
  listPublishedEvents: () => Promise<Event[]>;
  /** May return drafts; the tool filters them out. */
  getEventBySlug: (slug: string) => Promise<ExpandedEvent | null>;
  getSpeakerDirectory: () => Promise<SpeakerDirectory>;
  /** Receives data-source failures; clients only see a retryable message. */
  reportError: (error: unknown, tool: string) => void;
};

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Runs a tool body; data-source failures become a reported, retryable error. */
async function withDataSource(
  deps: AtwMcpDependencies,
  tool: string,
  subject: string,
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    deps.reportError(error, tool);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `All Things Web ${subject} are temporarily unavailable. Please retry in a minute.`,
        },
      ],
    };
  }
}

function json(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];
}

export function registerAtwTools(
  server: McpServer,
  deps: AtwMcpDependencies,
): void {
  server.registerTool(
    "list_events",
    {
      title: "List events",
      description:
        "List All Things Web events in San Francisco. Upcoming (including live) events come soonest first; past events come most recent first. Registration always happens at each event's rsvpUrl.",
      inputSchema: z.object({
        when: z
          .enum(["upcoming", "past", "all"])
          .default("upcoming")
          .describe("Which events to list."),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: z.object({ events: z.array(eventSummarySchema) }),
      annotations: readOnly,
    },
    async ({ when, limit }) =>
      withDataSource(deps, "list_events", "events", async () => {
        const now = deps.now();
        const events = (await deps.listPublishedEvents())
          .filter((event) => {
            if (when === "all") return true;
            const isPast = eventStatus(event, now) === "past";
            return when === "past" ? isPast : !isPast;
          })
          .sort((a, b) =>
            when === "upcoming"
              ? a.startDate.getTime() - b.startDate.getTime()
              : b.startDate.getTime() - a.startDate.getTime(),
          )
          .slice(0, limit)
          .map((event) => toPublicEventSummary(event, deps.origin, now));
        const result = { events };
        return { content: json(result), structuredContent: result };
      }),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event",
      description:
        "Get one All Things Web event by slug: schedule, venue, talks with speakers, hosting companies and where to register.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Event slug from list_events."),
      }),
      outputSchema: eventSchema,
      annotations: readOnly,
    },
    async ({ slug }) =>
      withDataSource(deps, "get_event", "event details", async () => {
        const event = await deps.getEventBySlug(slug);
        if (!event || event.isDraft) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: eventNotFoundMessage(slug),
              },
            ],
          };
        }
        const result = toPublicEvent(event, deps.origin, deps.now());
        return { content: json(result), structuredContent: result };
      }),
  );

  server.registerTool(
    "list_speakers",
    {
      title: "List speakers",
      description:
        "List people who have spoken at past All Things Web events, with their talks. Optionally filter by a case-insensitive name, title or talk search.",
      inputSchema: z.object({
        query: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      outputSchema: z.object({ speakers: z.array(speakerSchema) }),
      annotations: readOnly,
    },
    async ({ query, limit }) =>
      withDataSource(deps, "list_speakers", "speakers", async () => {
        const needle = query?.toLowerCase();
        const speakers = toPublicSpeakers(
          await deps.getSpeakerDirectory(),
          deps.origin,
        )
          .filter(
            (speaker) =>
              !needle ||
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
        const result = { speakers };
        return { content: json(result), structuredContent: result };
      }),
  );

  server.registerTool(
    "get_community",
    {
      title: "About All Things Web",
      description:
        "What All Things Web is: mission, history, how hosting works, and links to events, Discord and the code of conduct.",
      inputSchema: z.object({}),
      outputSchema: communitySchema,
      annotations: readOnly,
    },
    async () => {
      const result = toPublicCommunity(deps.origin);
      return { content: json(result), structuredContent: result };
    },
  );
}
