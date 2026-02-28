import { db } from "@/lib/db";
import { mainConfig } from "@/lib/config";
import { eventsTable, type InsertEvent } from "@/lib/schema";
import { createLumaClient } from "@/lib/luma";
import { and, eq } from "drizzle-orm";
import { createGateway, generateText, tool } from "ai";
import { z } from "zod";

const DISCORD_AGENT_MODEL = "openai/gpt-5.3-medium";

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
  if (typeof eventData.tagline === "string") normalized.tagline = eventData.tagline;
  if (typeof eventData.startDate === "string") {
    normalized.startDate = toDate(eventData.startDate);
  }
  if (typeof eventData.endDate === "string") {
    normalized.endDate = toDate(eventData.endDate);
  }
  if ("lumaEventId" in eventData) normalized.lumaEventId = eventData.lumaEventId;
  if (typeof eventData.isDraft === "boolean") normalized.isDraft = eventData.isDraft;
  if (typeof eventData.isHackathon === "boolean") {
    normalized.isHackathon = eventData.isHackathon;
  }
  if (typeof eventData.highlightOnLandingPage === "boolean") {
    normalized.highlightOnLandingPage = eventData.highlightOnLandingPage;
  }
  if ("fullAddress" in eventData) normalized.fullAddress = eventData.fullAddress;
  if ("shortLocation" in eventData) normalized.shortLocation = eventData.shortLocation;
  if ("streetAddress" in eventData) normalized.streetAddress = eventData.streetAddress;
  if ("recordingUrl" in eventData) normalized.recordingUrl = eventData.recordingUrl;

  return normalized;
}

async function getEventBySlug(slug: string) {
  const [event] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.slug, slug))
    .limit(1);

  return event ?? null;
}

async function updateEventBySlug(input: z.infer<typeof updateEventInputSchema>) {
  const existingEvent = await getEventBySlug(input.slug);
  if (!existingEvent) {
    throw new Error(`Event not found for slug: ${input.slug}`);
  }

  const normalized = normalizeUpdateData(input.eventData);
  const [updated] = await db
    .update(eventsTable)
    .set(normalized)
    .where(and(eq(eventsTable.id, existingEvent.id)))
    .returning();

  return updated ?? null;
}

function buildTools() {
  return {
    get_event_by_slug: tool({
      description: "Fetch an AllThingsWeb event by slug.",
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
}): Promise<string> {
  const { text } = await generateText({
    model: getGatewayModel(),
    tools: buildTools(),
    system: `You are the AllThingsWeb Discord ops assistant.
You can inspect and update AllThingsWeb event data and fetch Luma event payloads.
Use tools whenever the answer depends on current data.
Before updating event data, confirm intent from the user message and summarize what changed.
Be concise and action-oriented.`,
    prompt: input.prompt,
  });

  return text.trim();
}
