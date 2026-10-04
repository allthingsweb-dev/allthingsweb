import { afterAll, describe, expect, test } from "bun:test";
import {
  displayName,
  eventTopic,
  isTopic,
  maxTopicLength,
  topicOf,
} from "../src/lockup.ts";
import { migratedDatabase } from "./support/database.ts";
import { notTopics, topics } from "./support/topics.ts";

describe("topicOf", () => {
  // Every published event's name as of 2026-10-04, and what lists show.
  test.each([
    ["Effect San Francisco 🇺🇸", "effect"],
    ["All Things Agent Setups", "agent setups"],
    ["All Things Sync", "sync"],
    ["TypeScript AI Demo Day", "typescript ai demo day"],
    ["Dev Setup Demos - Show your agents.md!", undefined],
    ["DevTool AX Demos", "devtool ax demos"],
    ["All Things Expo!", "expo"],
    ["TypeScript AI: The official conference after-party", undefined],
    ["After Party - All Things React Native", undefined],
    ["All Things React Native", "react native"],
    ["Pre Next.js Conf / Ship AI Meetup", undefined],
    ["JS Trivia Night", "js trivia night"],
    ["Agents for Web Dev", "agents for web dev"],
    ["Lightning Hackathon ⚡", "lightning hackathon"],
    ["All Things Web Show & Tell", "web show & tell"],
    ["NextDev.fm Live", "nextdev.fm live"],
    ["All Things Web at Vapi", "web"],
    ["Future of Web Hackathon", "future of web hackathon"],
    ["AI x All Things Web", undefined],
    ["All Things Web at Convex", "web"],
    ["All Things Web Hack Evening", "web hack evening"],
    ["All Things Web at Sentry", "web"],
    ["All Things Web at Sanity", "web"],
    ["All Things Web @ Vercel HQ 👀", "web"],
    ["All Things Web at Little Skillet", "web"],
    ["Pre Next.js Conf Meetup", "pre next.js conf meetup"],
    ["Open Source Hackathon", "open source hackathon"],
    ["React Bay Area at Cisco Meraki", "react bay area"],
    ["React Bay Area at Mux", "react bay area"],
    ["Remix Bay Area at Little Skillet", "remix bay area"],
    ["React Bay Area at Sanity", "react bay area"],
    ["Remix Bay Area at Solv", "remix bay area"],
  ])("%j is at/%s", (name, topic) => {
    expect(topicOf(name)).toBe(topic);
  });

  test.each([
    ["all things effect", "effect"],
    ["ALL THINGS  Expo", "expo"],
    ["Effect SF", "effect"],
    ["Effect in San Francisco", "effect"],
    ["All Things Web 👋🏽", "web"],
    ["Café Night", "café night"],
    ["Server-Side Rendering", "server-side rendering"],
    ["C++ & C#", "c++ & c#"],
    ["Rock 'n' Roll", "rock 'n' roll"],
  ])("%j is at/%s", (name, topic) => {
    expect(topicOf(name)).toBe(topic);
  });

  test.each([
    "",
    "🎉",
    "All Things",
    "All Things Web: Season 2",
    "React / Remix",
    "Kickoff - Day 1",
    "-dash first",
    "Talks (and pizza)",
    "a".repeat(maxTopicLength + 1),
  ])("%j has no topic", (name) => {
    expect(topicOf(name)).toBeUndefined();
  });

  test("allows a topic of the longest length", () => {
    expect(topicOf("a".repeat(maxTopicLength))).toBe(
      "a".repeat(maxTopicLength),
    );
  });
});

describe("displayName", () => {
  test.each([
    ["Effect San Francisco 🇺🇸", "Effect San Francisco"],
    ["All Things Web @ Vercel HQ 👀", "All Things Web @ Vercel HQ"],
    ["Lightning Hackathon ⚡️", "Lightning Hackathon"],
    ["Hack night 👩‍💻", "Hack night"],
    ["Round 1️⃣", "Round 1"],
    ["All Things Web 👋🏽", "All Things Web"],
    ["Hack night 👩🏾‍💻", "Hack night"],
    ["Effect Glasgow 🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Effect Glasgow"],
    [
      "  Dev Setup Demos -  Show your agents.md! ",
      "Dev Setup Demos - Show your agents.md!",
    ],
    ["Café night", "Café night"],
  ])("%j is shown as %j", (name, shown) => {
    expect(displayName(name)).toBe(shown);
  });
});

describe("isTopic", () => {
  test.each([...topics])("%j is a topic", (topic) => {
    expect(isTopic(topic)).toBe(true);
  });

  test.each([...notTopics])("%j is not a topic", (topic) => {
    expect(isTopic(topic)).toBe(false);
  });
});

/**
 * The topics the site sets for the published events whose names yield none
 * (migrations/0002_event_topic.ts), keyed by Luma id there.
 */
const setOnTheSite = [
  ["Dev Setup Demos - Show your agents.md!", "dev setups"],
  [
    "TypeScript AI: The official conference after-party",
    "typescript ai afterparty",
  ],
  ["After Party - All Things React Native", "react native after-party"],
  ["Pre Next.js Conf / Ship AI Meetup", "ship ai"],
  ["AI x All Things Web", "ai"],
] as const;

describe("eventTopic", () => {
  test.each(setOnTheSite)(
    "%j, whose name yields no topic, is at/%s as the site sets it",
    (name, topic) => {
      expect(topicOf(name)).toBeUndefined();
      expect(isTopic(topic)).toBe(true);
      expect(eventTopic({ name, topic })).toBe(topic);
    },
  );

  test("prefers the topic the site sets to the one the name yields", () => {
    expect(
      eventTopic({ name: "All Things Web at Vapi", topic: "voice ai" }),
    ).toBe("voice ai");
  });

  test("falls back to the name's topic, or none", () => {
    expect(eventTopic({ name: "All Things Expo!", topic: null })).toBe("expo");
    expect(
      eventTopic({ name: "AI x All Things Web", topic: null }),
    ).toBeUndefined();
  });
});

const db = await migratedDatabase();
afterAll(() => db.close());

describe("the CHECK on events.topic", () => {
  /** Whether the database stores `topic` on an event, or the CHECK refuses it. */
  async function stores(topic: string): Promise<boolean> {
    try {
      await db.query(
        `INSERT INTO events (slug, name, tagline, start_date, end_date, attendee_limit, updated_at, topic)
         VALUES (gen_random_uuid()::text, 'Event', '', now(), now(), 0, now(), $1)`,
        [topic],
      );
      return true;
    } catch (error) {
      if (String(error).includes("events_topic_check")) return false;
      throw error;
    }
  }

  test.each([...topics, ...notTopics])(
    "agrees with isTopic on %j",
    async (topic) => {
      expect(await stores(topic)).toBe(isTopic(topic));
    },
  );

  test("allows no topic", async () => {
    await db.query(
      `INSERT INTO events (slug, name, tagline, start_date, end_date, attendee_limit, updated_at)
       VALUES ('no-topic', 'Event', '', now(), now(), 0, now())`,
    );
    expect(
      (await db.query(`SELECT topic FROM events WHERE slug = 'no-topic'`)).rows,
    ).toEqual([{ topic: null }]);
  });
});
