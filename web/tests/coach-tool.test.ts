import { describe, expect, test } from "bun:test";
import { coach, limits } from "allthings-core/src/coaching.ts";
import { Effect } from "effect";
import { maxRequestBodySize } from "../src/mcp/server.ts";
import {
  isKeptTool,
  isToolName,
  toolInputs,
  toolProgram,
} from "../src/mcp/tools.ts";
import { Site } from "../src/site.ts";

/**
 * coach_talk (web/src/mcp/tools.ts): core's coaching, as the MCP tool
 * serves it, with its defaults and limits, and never through the store.
 */

const run = (input: unknown) => {
  const program = toolProgram("coach_talk", input);
  return program === undefined
    ? undefined
    : Effect.runSync(
        program.pipe(
          Effect.provideService(
            Site,
            Site.of({
              origin: "https://allthings.dev",
              media: "https://media.allthings.dev",
            }),
          ),
        ),
      );
};

describe("coach_talk", () => {
  test("answers with core's coaching, an open floor's 3 minutes by default", () => {
    const transcript = "Hi, I'm Sam and I built a queue. ".repeat(60);
    const result = run({ title: "A queue", transcript });
    expect(result?.isError).toBeUndefined();
    expect(result?.structuredContent).toEqual(
      coach({
        slot: { format: "open-floor", minutes: 3 },
        title: "A queue",
        transcript,
      }),
    );
  });

  test("a talk is 20 minutes unless it says, and goals pass through", () => {
    expect(run({ format: "talk" })?.structuredContent).toMatchObject({
      slot: { format: "talk", minutes: 20 },
    });
    expect(
      run({ format: "talk", minutes: 12, goals: ["get-hired"] })
        ?.structuredContent,
    ).toMatchObject({
      slot: { format: "talk", minutes: 12 },
      goals: ["get-hired"],
    });
  });

  test("refuses input past its limits, or goals it doesn't know", () => {
    for (const input of [
      { minutes: 0 },
      { minutes: 61 },
      { title: "x".repeat(limits.title + 1) },
      { transcript: "x".repeat(limits.transcript + 1) },
      { goals: ["sell-things"] },
      {
        goals: [
          "first-talk",
          "get-hired",
          "first-talk",
          "get-hired",
          "first-talk",
          "get-hired",
        ],
      },
    ]) {
      expect(run(input)).toBeUndefined();
    }
  });

  test("its largest call fits in a request body, however it is escaped", () => {
    // Every field at its limit, in a character that takes three bytes as
    // UTF-8, or six when a client escapes it as 語: the most a body can
    // hold that the tool accepts.
    const full = (max: number) => "語".repeat(max);
    const call = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "coach_talk",
        arguments: {
          format: "open-floor",
          minutes: 60,
          title: full(limits.title),
          abstract: full(limits.abstract),
          outline: full(limits.outline),
          transcript: full(limits.transcript),
          goals: toolInputs.coach_talk.shape.goals.unwrap().element.options,
        },
      },
    });
    const escaped = call.replaceAll("語", "\\u8a9e");
    expect(JSON.parse(escaped)).toEqual(JSON.parse(call));
    for (const body of [call, escaped]) {
      expect(new TextEncoder().encode(body).length).toBeLessThan(
        maxRequestBodySize,
      );
    }
  });

  test("is never answered through the page store", () => {
    expect(isToolName("coach_talk")).toBe(true);
    expect(isKeptTool("coach_talk")).toBe(false);
    for (const name of [
      "list_events",
      "get_event",
      "list_speakers",
      "get_community",
      "get_guide",
      "get_year",
      "get_letter",
    ]) {
      expect(isKeptTool(name)).toBe(true);
    }
  });
});
