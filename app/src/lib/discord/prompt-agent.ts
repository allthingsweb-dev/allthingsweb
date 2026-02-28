import { db } from "@/lib/db";
import { mainConfig } from "@/lib/config";
import { eventsTable, type InsertEvent } from "@/lib/schema";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { createLumaClient } from "@/lib/luma";
import { desc, eq } from "drizzle-orm";
import { createGateway, generateText, tool } from "ai";
import { z } from "zod";

const DISCORD_AGENT_MODEL = "anthropic/claude-sonnet-4.6";
const MAX_CONTEXT_MESSAGE_LENGTH = 500;

type RecentDiscordMessage = {
  author: string;
  text: string;
  isBot: boolean;
};

const updateEventInputSchema = z.object({
  slug: z.string().min(1),
  eventData: z
    .object({
      name: z.string().optional(),
      slug: z.string().optional(),
      attendeeLimit: z.number().int().positive().optional(),
      tagline: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      lumaEventId: z.string().nullable().optional(),
      isDraft: z.boolean().optional(),
      isHackathon: z.boolean().optional(),
      highlightOnLandingPage: z.boolean().optional(),
      fullAddress: z.string().nullable().optional(),
      shortLocation: z.string().nullable().optional(),
      streetAddress: z.string().nullable().optional(),
      recordingUrl: z.string().nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "eventData must include at least one field",
    }),
});

function getGatewayModel() {
  const gatewayApiKey = mainConfig.ai.gatewayApiKey;
  const oidcToken = mainConfig.ai.vercelOidcToken;

  if (!gatewayApiKey && !oidcToken) {
    throw new Error(
      "AI gateway auth missing. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
    );
  }

  if (gatewayApiKey) {
    return createGateway({ apiKey: gatewayApiKey })(DISCORD_AGENT_MODEL);
  }

  return createGateway({
    headers: {
      Authorization: `Bearer ${oidcToken}`,
    },
  })(DISCORD_AGENT_MODEL);
}

function toDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return date;
}

function normalizeUpdateData(
  eventData: z.infer<typeof updateEventInputSchema>["eventData"],
): Partial<InsertEvent> {
  const normalized: Partial<InsertEvent> = {};

  if (typeof eventData.name === "string") normalized.name = eventData.name;
  if (typeof eventData.slug === "string") normalized.slug = eventData.slug;
  if (typeof eventData.attendeeLimit === "number") {
    normalized.attendeeLimit = eventData.attendeeLimit;
  }
  if (typeof eventData.tagline === "string")
    normalized.tagline = eventData.tagline;
  if (typeof eventData.startDate === "string") {
    normalized.startDate = toDate(eventData.startDate);
  }
  if (typeof eventData.endDate === "string") {
    normalized.endDate = toDate(eventData.endDate);
  }
  if ("lumaEventId" in eventData)
    normalized.lumaEventId = eventData.lumaEventId;
  if (typeof eventData.isDraft === "boolean")
    normalized.isDraft = eventData.isDraft;
  if (typeof eventData.isHackathon === "boolean") {
    normalized.isHackathon = eventData.isHackathon;
  }
  if (typeof eventData.highlightOnLandingPage === "boolean") {
    normalized.highlightOnLandingPage = eventData.highlightOnLandingPage;
  }
  if ("fullAddress" in eventData)
    normalized.fullAddress = eventData.fullAddress;
  if ("shortLocation" in eventData)
    normalized.shortLocation = eventData.shortLocation;
  if ("streetAddress" in eventData)
    normalized.streetAddress = eventData.streetAddress;
  if ("recordingUrl" in eventData)
    normalized.recordingUrl = eventData.recordingUrl;

  return normalized;
}

async function getEventBySlug(slug: string) {
  return getExpandedEventBySlug(slug);
}

async function listEventsSummary() {
  const events = await db
    .select({
      name: eventsTable.name,
      slug: eventsTable.slug,
      startDate: eventsTable.startDate,
      endDate: eventsTable.endDate,
      shortLocation: eventsTable.shortLocation,
      fullAddress: eventsTable.fullAddress,
    })
    .from(eventsTable)
    .orderBy(desc(eventsTable.startDate));

  return events.map((event) => ({
    name: event.name,
    slug: event.slug,
    date: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    location: event.shortLocation ?? event.fullAddress ?? null,
  }));
}

async function updateEventBySlug(
  input: z.infer<typeof updateEventInputSchema>,
) {
  const existingEvent = await getEventBySlug(input.slug);
  if (!existingEvent) {
    throw new Error(`Event not found for slug: ${input.slug}`);
  }

  const normalized = normalizeUpdateData(input.eventData);
  if (Object.keys(normalized).length === 0) {
    throw new Error("No valid fields were provided for update");
  }

  const [updated] = await db
    .update(eventsTable)
    .set(normalized)
    .where(eq(eventsTable.id, existingEvent.id))
    .returning();

  return updated ?? null;
}

function buildTools() {
  return {
    list_events: tool({
      description:
        "List AllThingsWeb events with summary fields: name, date, location, and slug.",
      inputSchema: z.object({}),
      execute: async () => listEventsSummary(),
    }),
    get_event_by_slug: tool({
      description:
        "Fetch a full AllThingsWeb event by slug, including speakers, sponsors, and talks.",
      inputSchema: z.object({
        slug: z.string().min(1),
      }),
      execute: async ({ slug }) => getEventBySlug(slug),
    }),
    update_event: tool({
      description:
        "Update an AllThingsWeb event by slug. Use this only when the user explicitly asks to change event data.",
      inputSchema: updateEventInputSchema,
      execute: async ({ slug, eventData }) =>
        updateEventBySlug({
          slug,
          eventData,
        }),
    }),
    get_luma_event: tool({
      description: "Fetch a Luma event payload by Luma event ID (api_id).",
      inputSchema: z.object({
        eventId: z.string().min(1),
      }),
      execute: async ({ eventId }) => createLumaClient().getEvent(eventId),
    }),
  };
}

export async function runDiscordPromptAgent(input: {
  prompt: string;
  recentMessages?: RecentDiscordMessage[];
}): Promise<string> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return "Please provide a prompt.";
  }

  const contextText =
    input.recentMessages && input.recentMessages.length > 0
      ? `Recent Discord messages (oldest to newest):\n${input.recentMessages
          .map((message) => {
            const role = message.isBot ? "bot" : "user";
            const text = message.text
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, MAX_CONTEXT_MESSAGE_LENGTH);
            return `- [${role}] ${message.author}: ${text}`;
          })
          .join("\n")}\n\nLatest user prompt:\n${prompt}`
      : prompt;
  console.info(
    `[discord-context] prompt_agent receivedMessages=${input.recentMessages?.length ?? 0} finalPromptChars=${contextText.length}`,
  );

  const { text } = await generateText({
    model: getGatewayModel(),
    tools: buildTools(),
    system: `You are the AllThingsWeb Discord ops assistant.
You can inspect and update AllThingsWeb event data and fetch Luma event payloads.
Use tools whenever the answer depends on current data.
Before updating event data, confirm intent from the user message and summarize what changed.
If user intent is ambiguous, ask a clarifying question instead of calling update tools.
Be concise and action-oriented.`,
    prompt: contextText,
  });

  return text.trim();
}
