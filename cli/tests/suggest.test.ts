import { describe, expect, test } from "bun:test";
import { distance, suggest } from "../src/suggest.ts";

describe("suggest", () => {
  const commands = [
    "events",
    "event",
    "speakers",
    "rsvp",
    "about",
    "mcp",
    "aux",
    "help",
  ];

  test("counts a swap of neighboring letters as one edit", () => {
    expect(distance("evnets", "events")).toBe(1);
    expect(distance("events", "events")).toBe(0);
    expect(distance("", "aux")).toBe(3);
  });

  test("finds what a typo meant", () => {
    expect(suggest("evnts", commands)).toBe("events");
    expect(suggest("evnets", commands)).toBe("events");
    expect(suggest("rsvpp", commands)).toBe("rsvp");
    expect(suggest("abotu", commands)).toBe("about");
    expect(suggest("Speakers", commands)).toBe("speakers");
  });

  test("completes a word cut short", () => {
    expect(suggest("speaker", commands)).toBe("speakers");
    expect(suggest("even", commands)).toBe("events");
  });

  test("keeps quiet when nothing is close", () => {
    expect(suggest("frobnicate", commands)).toBeUndefined();
    expect(suggest("x", commands)).toBeUndefined();
    expect(suggest("", commands)).toBeUndefined();
    // Short words don't match everything two edits away.
    expect(suggest("ab", commands)).toBeUndefined();
  });
});
