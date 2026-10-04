import { describe, expect, test } from "bun:test";
import { displayName, maxTopicLength, topicOf } from "../src/lockup.ts";

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
    [
      "  Dev Setup Demos -  Show your agents.md! ",
      "Dev Setup Demos - Show your agents.md!",
    ],
    ["Café night", "Café night"],
  ])("%j is shown as %j", (name, shown) => {
    expect(displayName(name)).toBe(shown);
  });
});
