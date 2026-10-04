import { describe, expect, test } from "bun:test";
import { createMcpHandler } from "mcp-handler";
import type { Event } from "../src/lib/events";
import type { ExpandedEvent } from "../src/lib/expanded-events";
import {
  registerAtwTools,
  type AtwMcpDependencies,
} from "../src/lib/mcp/tools";
import type { SpeakerDirectory } from "../src/lib/public-api/mappers";
import { sanitizeRichText } from "../src/lib/safe-html";
import {
  communitySchema,
  eventSchema,
  eventSummarySchema,
  speakerSchema,
} from "../src/lib/public-api/schemas";

const now = new Date("2026-09-30T20:00:00Z");
const origin = "https://allthingsweb.dev";

function event(overrides: Partial<Event> & Pick<Event, "slug">): Event {
  return {
    id: overrides.slug,
    name: overrides.slug,
    tagline: "Tagline",
    startDate: new Date("2026-10-01T00:30:00Z"),
    endDate: new Date("2026-10-01T03:30:00Z"),
    attendeeLimit: 0,
    streetAddress: null,
    shortLocation: "CodeRabbit",
    fullAddress: "201 Spear St, San Francisco, CA 94105",
    lumaEventId: "evt-1",
    lumaEventUrl: "https://lu.ma/event/evt-1",
    isHackathon: false,
    isDraft: false,
    highlightOnLandingPage: false,
    previewImage: null,
    recordingUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const past = event({
  slug: "past",
  startDate: new Date("2026-09-01T00:30:00Z"),
  endDate: new Date("2026-09-01T03:30:00Z"),
});
const older = event({
  slug: "older",
  startDate: new Date("2026-08-01T00:30:00Z"),
  endDate: new Date("2026-08-01T03:30:00Z"),
});
const live = event({
  slug: "live",
  startDate: new Date("2026-09-30T19:00:00Z"),
  endDate: new Date("2026-09-30T22:00:00Z"),
});
const next = event({ slug: "effect-sf" });
const later = event({
  slug: "later",
  startDate: new Date("2026-11-01T00:30:00Z"),
  endDate: new Date("2026-11-01T03:30:00Z"),
});

const expanded: ExpandedEvent = {
  ...next,
  images: [],
  hosts: [
    {
      id: "coderabbit",
      name: "CodeRabbit",
      about: "AI code reviews.",
      squareLogoLight: { url: "/l.png", alt: "" },
      squareLogoDark: { url: "/d.png", alt: "" },
    },
  ],
  talks: [
    {
      id: "fireside",
      title: "Fireside chat",
      description: sanitizeRichText(
        "<p>Effect &amp; you</p><ul><li>Typed errors</li><li>Concurrency</li></ul>",
      ),
      speakers: [
        {
          id: "michael",
          name: "Michael Arnaldi",
          title: "Creator of Effect",
          image: { url: "/m.png", alt: "" },
          bio: "Founder.",
          socials: { twitter: "MichaelArnaldi" },
        },
      ],
    },
  ],
};

const directory: SpeakerDirectory = {
  speakers: [
    {
      profile: {
        id: "p1",
        name: "Ada Lovelace",
        title: "Engineer",
        bio: "Wrote the first program.",
        twitterHandle: null,
        blueskyHandle: "ada.dev",
        linkedinHandle: null,
      } as SpeakerDirectory["speakers"][number]["profile"],
      image: null,
      talkIds: ["t1"],
    },
  ],
  talks: [
    {
      id: "t1",
      title: "Analytical engines",
      description: "",
      speakerIds: ["p1"],
      eventId: "e1",
      eventName: "Past event",
      eventSlug: "past",
      eventStart: past.startDate,
    },
  ],
};

const reported: { error: unknown; tool: string }[] = [];

function createHandler(overrides: Partial<AtwMcpDependencies> = {}) {
  return createMcpHandler((server) =>
    registerAtwTools(server, {
      origin,
      now: () => now,
      listPublishedEvents: async () => [past, older, live, next, later],
      getEventBySlug: async (slug) =>
        slug === expanded.slug
          ? expanded
          : slug === "draft"
            ? { ...expanded, slug: "draft", isDraft: true }
            : null,
      getSpeakerDirectory: async () => directory,
      reportError: (error, tool) => reported.push({ error, tool }),
      ...overrides,
    }),
  );
}

const handler = createHandler();

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  mcp = handler,
) {
  const response = await mcp(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const data = (await response.text())
    .split("\n")
    .find((line) => line.startsWith("data: "));
  return JSON.parse(data!.slice("data: ".length)).result as {
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
  };
}

describe("public MCP server", () => {
  test("lists upcoming events, including live ones, soonest first", async () => {
    const result = await callTool("list_events");
    const { events } = result.structuredContent as {
      events: { slug: string; status: string }[];
    };
    expect(events.map((e) => [e.slug, e.status])).toEqual([
      ["live", "live"],
      ["effect-sf", "upcoming"],
      ["later", "upcoming"],
    ]);
    for (const summary of events) eventSummarySchema.parse(summary);
  });

  test("lists past events most recent first and honours the limit", async () => {
    const result = await callTool("list_events", { when: "past", limit: 1 });
    expect(result.structuredContent).toMatchObject({
      events: [{ slug: "past", status: "past" }],
    });
  });

  test("returns event details with plain-text talks, speakers and hosts", async () => {
    const result = await callTool("get_event", { slug: "effect-sf" });
    const details = eventSchema.parse(result.structuredContent);
    expect(details.url).toBe("https://allthingsweb.dev/effect-sf");
    expect(details.rsvpUrl).toBe("https://lu.ma/event/evt-1");
    expect(details.talks[0].description).toBe(
      "Effect & you\n\n- Typed errors\n- Concurrency",
    );
    expect(details.talks[0].speakers[0]).toEqual({
      name: "Michael Arnaldi",
      title: "Creator of Effect",
      bio: "Founder.",
      links: {
        x: "https://twitter.com/MichaelArnaldi",
        bluesky: null,
        linkedin: null,
      },
    });
    expect(details.hosts).toEqual([
      { name: "CodeRabbit", about: "AI code reviews." },
    ]);
  });

  test("never reveals drafts or unknown events", async () => {
    for (const slug of ["draft", "missing"]) {
      const result = await callTool("get_event", { slug });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0].text).toContain(slug);
    }
  });

  test("lists speakers with their talks and filters by search", async () => {
    const all = await callTool("list_speakers");
    const [speaker] = (all.structuredContent as { speakers: unknown[] })
      .speakers;
    expect(speakerSchema.parse(speaker)).toMatchObject({
      name: "Ada Lovelace",
      links: { bluesky: "https://bsky.app/profile/ada.dev" },
      talks: [{ title: "Analytical engines", eventUrl: `${origin}/past` }],
    });
    const none = await callTool("list_speakers", { query: "nobody" });
    expect(none.structuredContent).toEqual({ speakers: [] });
  });

  test("describes the community with canonical links", async () => {
    const result = await callTool("get_community");
    expect(communitySchema.parse(result.structuredContent).links).toEqual({
      website: origin,
      events: "https://luma.com/allthingsweb",
      discord: "https://discord.gg/B3Sm4b5mfD",
      codeOfConduct: `${origin}/code-of-conduct`,
    });
  });

  test("publishes only valid http(s) URLs from stored data", async () => {
    const mcp = createHandler({
      listPublishedEvents: async () => [
        {
          ...next,
          recordingUrl: "javascript:alert(1)",
          lumaEventUrl: "not a url",
        },
      ],
    });
    const result = await callTool("list_events", {}, mcp);
    expect(result.structuredContent).toMatchObject({
      events: [{ slug: "effect-sf", recordingUrl: null, rsvpUrl: null }],
    });
  });

  test("turns data-source failures into reported, retryable errors", async () => {
    reported.length = 0;
    const failure = new Error("connection refused: db.internal:5432");
    const mcp = createHandler({
      listPublishedEvents: async () => Promise.reject(failure),
      getEventBySlug: async () => Promise.reject(failure),
      getSpeakerDirectory: async () => Promise.reject(failure),
    });
    for (const [tool, args] of [
      ["list_events", {}],
      ["get_event", { slug: "effect-sf" }],
      ["list_speakers", {}],
    ] as const) {
      const result = await callTool(tool, args, mcp);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("temporarily unavailable");
      expect(result.content[0].text).not.toContain("db.internal");
    }
    expect(reported.map((r) => r.tool)).toEqual([
      "list_events",
      "get_event",
      "list_speakers",
    ]);
    expect(reported.every((r) => r.error === failure)).toBe(true);
  });
});
