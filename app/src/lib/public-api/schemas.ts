import { z } from "zod";

/** Public, stable shapes shared by the MCP server and other agent-facing APIs. */

export const eventStatusSchema = z
  .enum(["upcoming", "live", "past"])
  .describe("Whether the event is still ahead, happening now, or over.");

export const personLinksSchema = z.object({
  x: z.string().nullable(),
  bluesky: z.string().nullable(),
  linkedin: z.string().nullable(),
});

export const eventSummarySchema = z.object({
  slug: z.string().describe("Stable identifier; pass it to get_event."),
  name: z.string(),
  tagline: z.string(),
  url: z.string().describe("Event page on allthingsweb.dev."),
  status: eventStatusSchema,
  startsAt: z.iso.datetime().describe("Start time as an ISO 8601 UTC instant."),
  endsAt: z.iso.datetime().describe("End time as an ISO 8601 UTC instant."),
  timeZone: z
    .literal("America/Los_Angeles")
    .describe("Local time zone for presenting times."),
  venue: z
    .object({ name: z.string().nullable(), address: z.string().nullable() })
    .nullable(),
  rsvpUrl: z
    .string()
    .nullable()
    .describe("Where to register. Registration always happens on this page."),
  recordingUrl: z.string().nullable(),
  isHackathon: z.boolean(),
});

export const talkSpeakerSchema = z.object({
  name: z.string(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  links: personLinksSchema,
});

export const eventSchema = eventSummarySchema.extend({
  talks: z.array(
    z.object({
      title: z.string(),
      description: z.string().describe("Plain text."),
      speakers: z.array(talkSpeakerSchema),
    }),
  ),
  hosts: z
    .array(z.object({ name: z.string(), about: z.string() }))
    .describe("Companies hosting the event: space, food and drinks."),
});

export const speakerSchema = talkSpeakerSchema.extend({
  talks: z.array(
    z.object({
      title: z.string(),
      eventName: z.string(),
      eventSlug: z.string(),
      eventUrl: z.string(),
      date: z.iso.datetime(),
    }),
  ),
});

export const communitySchema = z.object({
  name: z.string(),
  oneLiner: z.string(),
  introduction: z.string(),
  mission: z.string(),
  history: z.string(),
  independence: z.string(),
  hosting: z.string(),
  links: z.object({
    website: z.string(),
    events: z.string(),
    discord: z.string(),
    codeOfConduct: z.string(),
  }),
});

export type EventStatus = z.infer<typeof eventStatusSchema>;
export type PublicEventSummary = z.infer<typeof eventSummarySchema>;
export type PublicEvent = z.infer<typeof eventSchema>;
export type PublicSpeaker = z.infer<typeof speakerSchema>;
export type PublicCommunity = z.infer<typeof communitySchema>;
