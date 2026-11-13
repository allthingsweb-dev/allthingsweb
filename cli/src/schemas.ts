import { z } from "zod";

/**
 * The public allthings contract, as served by https://allthings.dev/mcp.
 * Mirrors core's (core/src/contract.ts), the one source of it;
 * core/tests/contract.test.ts holds the two to the same JSON Schema and the
 * same verdicts.
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
  curation: z.enum(["ours", "shared"]),
  organizer: z
    .object({ name: z.string(), url: z.httpUrl().nullable() })
    .nullable(),
});

export const talkSpeakerSchema = z.object({
  name: z.string(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  links: personLinksSchema,
});

export const talkRecordingSchema = z.object({
  url: z.httpUrl(),
  startSeconds: z.int().min(0).nullable(),
});

export const talkArtifactSchema = z.object({
  kind: z.enum(["recording", "slides", "repo", "site", "other"]),
  url: z.httpUrl(),
  label: z.string().nullable(),
  elsewhere: z.string().nullable(),
});

export const eventSchema = eventSummarySchema.extend({
  talks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      speakers: z.array(talkSpeakerSchema),
      recording: talkRecordingSchema.nullable(),
      artifacts: z.array(talkArtifactSchema),
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

export const guideEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  stars: z.literal([1, 2, 3]),
  meaning: z.string(),
  city: z.string(),
  organizer: z.string(),
  url: z.httpUrl(),
  why: z.string(),
  next: z.object({ from: z.iso.date(), to: z.iso.date() }).nullable(),
  guideUrl: z.httpUrl(),
});

export const guideSchema = z.object({
  about: z.string(),
  url: z.httpUrl(),
  entries: z.array(guideEntrySchema),
});

export const eventListSchema = z.object({
  events: z.array(eventSummarySchema),
});
export const speakerListSchema = z.object({ speakers: z.array(speakerSchema) });

/**
 * coach_talk's answer and limits, mirroring core's coaching
 * (core/src/coaching.ts): `coachingSchema` is held to its `Coaching` by
 * core/tests/contract.test.ts, and the limits and goals to its own.
 */

export const slotFormats = ["open-floor", "talk"] as const;

export const goals = [
  "first-talk",
  "teach-a-technique",
  "find-contributors",
  "show-a-launch",
  "get-hired",
] as const;

/** The longest each part of a talk coach_talk takes, in characters. */
export const coachingLimits = {
  title: 200,
  abstract: 3_000,
  outline: 20_000,
  transcript: 60_000,
  goals: 5,
} as const;

/** The longest slot coach_talk takes, in minutes. */
export const maxSlotMinutes = 60;

export const coachingSchema = z.object({
  slot: z.object({
    format: z.enum(slotFormats),
    minutes: z.number().int().min(1).max(maxSlotMinutes),
  }),
  goals: z.array(z.enum(goals)),
  measures: z.object({
    words: z.number().int().min(0).nullable(),
    timed: z.boolean(),
    seconds: z.number().int().min(0).nullable(),
    wordsPerMinute: z.number().int().min(0).nullable(),
    fillersPerMinute: z.number().min(0).nullable(),
    slides: z.number().int().min(0).nullable(),
    mostWordsOnASlide: z.number().int().min(0).nullable(),
  }),
  findings: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["must", "should", "consider"]),
      observed: z.string(),
      advice: z.string(),
    }),
  ),
  strengths: z.array(z.object({ id: z.string(), observed: z.string() })),
  unchecked: z.array(z.object({ id: z.string(), needs: z.string() })),
  summary: z.array(z.string()),
});

export type Coaching = z.infer<typeof coachingSchema>;
export type Goal = (typeof goals)[number];
export type SlotFormat = (typeof slotFormats)[number];

export type EventSummary = z.infer<typeof eventSummarySchema>;
export type Event = z.infer<typeof eventSchema>;
export type Speaker = z.infer<typeof speakerSchema>;
export type Community = z.infer<typeof communitySchema>;
export type GuideEntry = z.infer<typeof guideEntrySchema>;
export type Guide = z.infer<typeof guideSchema>;

/** What propose_talk answers when it takes a proposal (web/src/mcp/propose.ts). */
export const proposalAnswerSchema = z.object({
  received: z.boolean(),
  message: z.string(),
});
export type ProposalAnswer = z.infer<typeof proposalAnswerSchema>;

/** What propose_talk takes: the proposal, as the speaker gave it. */
export interface ProposalFields {
  readonly title: string;
  readonly abstract: string;
  readonly format?: "talk" | "lightning" | "demo";
  readonly name: string;
  readonly email: string;
  readonly about?: string;
  readonly links?: ReadonlyArray<string>;
  readonly notes?: string;
}
