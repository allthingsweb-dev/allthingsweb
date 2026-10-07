import { describe, expect, test } from "claude-code/testing";

import { NEIGHBORHOODS, neighborhoodOf, phraseAt } from "../hooks/city";
import {
  endpointOf,
  eveningOf,
  phaseOf,
  toolAnswerOf,
  topicOf,
} from "../hooks/evenings";
import { BRIDGE, GLOW, slashColorOf } from "../hooks/palette";
import { relative } from "../hooks/rows";
import { clockOf, dayOf, pacificOffset, spanOf, untilOf } from "../hooks/time";
import { AT, SUMMARY } from "./fixtures";

describe("the city", () => {
  test("the spinner walks at least 20 real neighborhoods, each once", () => {
    const names = NEIGHBORHOODS.map((hood) => hood.name);
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("FiDi");
    expect(names).not.toContain("Financial District");
  });

  test("every line is a lowercase verb somewhere in the city", () => {
    for (let n = 0; n < 200; n += 1)
      expect(phraseAt(n)).toMatch(/^[a-z]+ (in|from) (the )?[A-Z]/);
  });

  test("venues the community knows are named as locals name them", () => {
    expect(
      neighborhoodOf(
        "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
      ),
    ).toBe("East Cut");
    expect(
      neighborhoodOf("Sentry, 45 Fremont St, San Francisco, CA 94105, USA"),
    ).toBe("FiDi");
    expect(neighborhoodOf("444 De Haro Street, San Francisco, CA 94107")).toBe(
      "Potrero Hill",
    );
    expect(neighborhoodOf("Pier 70, San Francisco, CA 94107")).toBe("Dogpatch");
  });

  test("a new venue's neighborhood comes from its ZIP code, and nothing is guessed outside the city", () => {
    expect(neighborhoodOf("1 Valencia St, San Francisco, CA 94110")).toBe(
      "Mission",
    );
    expect(neighborhoodOf("1 Main St, Oakland, CA 94607")).toBeNull();
    expect(neighborhoodOf(null)).toBeNull();
    // A known street address matches whole, never inside a longer number.
    expect(neighborhoodOf("145 Fremont St, San Francisco, CA 94105")).toBe(
      "East Cut",
    );
  });
});

describe("evenings", () => {
  test("the topic is what follows all things, lowercase", () => {
    expect(topicOf("All Things Agent Setups")).toBe("agent-setups");
    expect(topicOf("allthings/effect")).toBe("effect");
    expect(topicOf("all things/react native")).toBe("react-native");
    expect(topicOf("Effect San Francisco 🇺🇸")).toBe("effect");
  });

  test("the server's URL is read from the plugin's MCP config", () => {
    expect(
      endpointOf(
        '{"mcpServers":{"allthings":{"type":"streamable-http","url":"https://allthings.dev/mcp"}}}',
      ),
    ).toBe("https://allthings.dev/mcp");
    expect(
      endpointOf(
        '{"allthings":{"type":"http","url":"https://allthings.dev/mcp"}}',
      ),
    ).toBe("https://allthings.dev/mcp");
    expect(endpointOf('{"mcpServers":{"x":{"command":"node"}}}')).toBeNull();
    expect(endpointOf("not json")).toBeNull();
  });

  test("answers are read from JSON and from an event stream", () => {
    const rpc = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [], structuredContent: { events: [] } },
    };
    expect(toolAnswerOf(JSON.stringify(rpc), "application/json")).toEqual({
      isError: false,
      structured: { events: [] },
    });
    expect(
      toolAnswerOf(
        `event: message\ndata: ${JSON.stringify(rpc)}\n\n`,
        "text/event-stream",
      ),
    ).toEqual({
      isError: false,
      structured: { events: [] },
    });
    expect(() =>
      toolAnswerOf(
        '{"jsonrpc":"2.0","id":1,"error":{"message":"bad"}}',
        "application/json",
      ),
    ).toThrow("bad");
  });

  test("an evening's phase follows the clock in San Francisco", () => {
    const evening = eveningOf(SUMMARY);
    expect(evening).not.toBeNull();
    if (evening === null) return;
    expect(phaseOf(evening, AT.upcoming)).toBe("upcoming");
    expect(phaseOf(evening, AT.today)).toBe("today");
    expect(phaseOf(evening, AT.live)).toBe("live");
    expect(phaseOf(evening, AT.past)).toBe("past");
  });
});

describe("San Francisco time", () => {
  test("follows daylight saving time", () => {
    expect(pacificOffset(Date.parse("2026-01-15T12:00:00Z"))).toBe(-8);
    expect(pacificOffset(Date.parse("2026-07-15T12:00:00Z"))).toBe(-7);
    // 2026: DST starts March 8 at 10:00 UTC and ends November 1 at 09:00 UTC.
    expect(pacificOffset(Date.parse("2026-03-08T09:59:00Z"))).toBe(-8);
    expect(pacificOffset(Date.parse("2026-03-08T10:00:00Z"))).toBe(-7);
    expect(pacificOffset(Date.parse("2026-11-01T08:59:00Z"))).toBe(-7);
    expect(pacificOffset(Date.parse("2026-11-01T09:00:00Z"))).toBe(-8);
  });

  test("reads dates, times and countdowns the way the site does", () => {
    const starts = Date.parse(SUMMARY.startsAt);
    expect(dayOf(starts)).toBe("thu oct 15");
    expect(clockOf(starts)).toBe("5:30pm");
    expect(clockOf(Date.parse("2026-10-16T01:00:00Z"))).toBe("6pm");
    expect(spanOf(starts, Date.parse(SUMMARY.endsAt))).toBe("5:30–8:30pm");
    expect(
      spanOf(
        Date.parse("2026-10-17T18:00:00Z"),
        Date.parse("2026-10-17T21:00:00Z"),
      ),
    ).toBe("11am–2pm");
    expect(untilOf(0, 134 * 60_000)).toBe("2h 14m");
    expect(untilOf(0, 45 * 60_000)).toBe("45m");
    expect(untilOf(0, 120 * 60_000)).toBe("2h");
  });
});

describe("the slash's color", () => {
  test("Bridge on light grounds, Glow on Night and dark ones", () => {
    expect(slashColorOf("light", undefined)).toBe(BRIDGE);
    expect(slashColorOf("light-daltonized", undefined)).toBe(BRIDGE);
    expect(slashColorOf("custom:allthings-paper", undefined)).toBe(BRIDGE);
    expect(slashColorOf("dark", undefined)).toBe(GLOW);
    expect(slashColorOf("custom:allthings-night", undefined)).toBe(GLOW);
    expect(slashColorOf("auto", "0;15")).toBe(BRIDGE);
    expect(slashColorOf("auto", "15;0")).toBe(GLOW);
    expect(slashColorOf("auto", undefined)).toBe(GLOW);
  });
});

describe("paths", () => {
  test("a path in the session's folder is drawn relative to it", () => {
    expect(relative("/work/src/app.ts", "/work")).toBe("src/app.ts");
    expect(relative("/elsewhere/a.ts", "/work")).toBe("/elsewhere/a.ts");
    expect(relative("/work", "/work")).toBe(".");
  });
});
