import { z } from "zod";

/**
 * The public all things contract, as served by https://allthings.dev/mcp.
 * Mirrors app/src/lib/public-api/schemas.ts; a contract test keeps them equal.
 */

export const eventStatusSchema = z.enum(["upcoming", "live", "past"]);

export const personLinksSchema = z.object({
  x: z.httpUrl().nullable(),
  bluesky: z.httpUrl().nullable(),
  linkedin: z.httpUrl().nullable(),
});

export const eventSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  url: z.httpUrl(),
  status: eventStatusSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: z.literal("America/Los_Angeles"),
  venue: z
    .object({ name: z.string().nullable(), address: z.string().nullable() })
    .nullable(),
  rsvpUrl: z.httpUrl().nullable(),
  recordingUrl: z.httpUrl().nullable(),
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
      description: z.string(),
      speakers: z.array(talkSpeakerSchema),
    }),
  ),
  hosts: z.array(z.object({ name: z.string(), about: z.string() })),
});

export const speakerSchema = talkSpeakerSchema.extend({
  talks: z.array(
    z.object({
      title: z.string(),
      eventName: z.string(),
      eventSlug: z.string(),
      eventUrl: z.httpUrl(),
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
    website: z.httpUrl(),
    events: z.httpUrl(),
    discord: z.httpUrl(),
    codeOfConduct: z.httpUrl(),
  }),
});

export const eventListSchema = z.object({
  events: z.array(eventSummarySchema),
});
export const speakerListSchema = z.object({ speakers: z.array(speakerSchema) });

export type EventSummary = z.infer<typeof eventSummarySchema>;
export type Event = z.infer<typeof eventSchema>;
export type Speaker = z.infer<typeof speakerSchema>;
export type Community = z.infer<typeof communitySchema>;
