import type { Client } from "../src/client.ts";
import type {
  Coaching,
  Community,
  Event,
  EventSummary,
  Guide,
  Speaker,
} from "../src/schemas.ts";

export const summary: EventSummary = {
  slug: "2026-09-30-effect",
  name: "Effect San Francisco",
  tagline: "An evening with Michael Arnaldi",
  url: "https://allthings.dev/2026-09-30-effect",
  status: "upcoming",
  startsAt: "2026-10-01T00:30:00.000Z",
  endsAt: "2026-10-01T03:30:00.000Z",
  timeZone: "America/Los_Angeles",
  venue: { name: "CodeRabbit", address: "201 Spear St, San Francisco, CA" },
  rsvpUrl: "https://lu.ma/event/evt-1",
  recordingUrl: null,
  isHackathon: false,
  curation: "ours",
  organizer: null,
};

export const event: Event = {
  ...summary,
  talks: [
    {
      title: "Fireside chat",
      description: "Typed errors and concurrency.",
      speakers: [
        {
          name: "Michael Arnaldi",
          title: "Creator of Effect",
          bio: null,
          links: {
            x: "https://twitter.com/MichaelArnaldi",
            bluesky: null,
            linkedin: null,
          },
        },
      ],
    },
  ],
  hosts: [{ name: "CodeRabbit", about: "AI code reviews." }],
};

export const speaker: Speaker = {
  name: "Ada Lovelace",
  title: "Engineer",
  bio: null,
  links: { x: null, bluesky: null, linkedin: null },
  talks: [
    {
      title: "Analytical engines",
      eventName: "All Things Web",
      eventSlug: "2024-05-14-remix",
      eventUrl: "https://allthings.dev/2024-05-14-remix",
      date: "2024-05-15T01:00:00.000Z",
    },
  ],
};

export const community: Community = {
  name: "allthings",
  oneLiner:
    "Evenings for people who build software. In the neighborhoods of San Francisco.",
  introduction: "Intro.",
  mission: "Mission.",
  history: "History.",
  independence: "Independence.",
  hosting: "Hosting.",
  links: {
    website: "https://allthings.dev",
    events: "https://luma.com/allthings",
    discord: "https://discord.gg/B3Sm4b5mfD",
    codeOfConduct: "https://allthings.dev/code-of-conduct",
  },
};

export const guide: Guide = {
  about: "Happenings worth the trip.",
  url: "https://allthings.dev/guide",
  entries: [
    {
      id: "react-miami",
      name: "React Miami",
      stars: 3,
      meaning: "worth a special journey",
      city: "Miami, Florida",
      organizer: "G2i",
      url: "https://www.reactmiami.com/",
      why: "Two days of React's best speakers.",
      next: { from: "2027-04-29", to: "2027-04-30" },
      guideUrl: "https://allthings.dev/guide#react-miami",
    },
    {
      id: "chain-react",
      name: "Chain React",
      stars: 3,
      meaning: "worth a special journey",
      city: "Portland, Oregon",
      organizer: "Infinite Red",
      url: "https://chainreactconf.com/",
      why: "The React Native conference.",
      next: null,
      guideUrl: "https://allthings.dev/guide#chain-react",
    },
    {
      id: "demo-night",
      name: "Demo Night",
      stars: 1,
      meaning: "worth a stop",
      city: "San Francisco",
      organizer: "Someone",
      url: "https://demo.example.com/",
      why: "Short demos.",
      next: { from: "2026-12-07", to: "2026-12-07" },
      guideUrl: "https://allthings.dev/guide#demo-night",
    },
  ],
};

/** coach_talk's answer for a 3-minute open floor that runs long. */
export const coaching: Coaching = {
  slot: { format: "open-floor", minutes: 3 },
  goals: ["find-contributors"],
  measures: {
    words: 426,
    timed: true,
    seconds: 185,
    wordsPerMinute: 138,
    fillersPerMinute: 1,
    slides: null,
    mostWordsOnASlide: null,
  },
  findings: [
    {
      id: "length",
      severity: "must",
      observed: "Your rehearsal runs 3:05, in a 3:00 slot.",
      advice:
        "Cut 0:25 to finish by 2:40. At 3:00 the screen goes to the timer, mid-sentence or mid-demo.",
    },
    {
      id: "find-contributors-issue",
      severity: "should",
      observed: "No first issue named.",
      advice:
        'Name one good first issue, or the "good first issue" label, so someone can start tonight.',
    },
  ],
  strengths: [
    { id: "no-pitch", observed: "Nothing to buy, book or sign up for." },
  ],
  unchecked: [
    { id: "slide-count", needs: "slides, separated by lines of ---" },
  ],
  summary: [
    "Cut 0:25 to finish by 2:40. At 3:00 the screen goes to the timer, mid-sentence or mid-demo.",
    'Name one good first issue, or the "good first issue" label, so someone can start tonight.',
  ],
};

export function fakeClient(overrides: Partial<Client> = {}): Client {
  return {
    listEvents: async () => [summary],
    getEvent: async () => event,
    listSpeakers: async () => [speaker],
    getCommunity: async () => community,
    getGuide: async () => guide,
    coachTalk: async () => coaching,
    proposeTalk: async () => ({
      received: true,
      message:
        "Thanks: your proposal is in. Erik and Andre read every one, and reply by email.",
    }),
    ...overrides,
  };
}
