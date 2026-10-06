import { describe, expect, test } from "bun:test";
import {
  planArguments,
  planSchemas,
  planToolDefinitions,
  planTools,
} from "../scripts/plan";

/**
 * The admin MCP server's planning tools (scripts/plan.ts) as core's
 * `bun run plan` reads them. What the CLI does with the arguments is
 * tested in core (tests/plan-cli.test.ts).
 */

describe("planning tools", () => {
  test("each tool is listed once, with the inputs its schema takes", () => {
    expect(planToolDefinitions.map((tool) => tool.name)).toEqual([
      ...planTools,
    ]);
    for (const definition of planToolDefinitions) {
      const shape = planSchemas[definition.name].shape as Record<
        string,
        { isOptional: () => boolean }
      >;
      expect(Object.keys(definition.inputSchema.properties).toSorted()).toEqual(
        Object.keys(shape).toSorted(),
      );
      expect(definition.inputSchema.required.toSorted()).toEqual(
        Object.entries(shape)
          .filter(([, field]) => !field.isOptional())
          .map(([name]) => name)
          .toSorted(),
      );
    }
  });

  test("an idea's fields become flags", () => {
    expect(
      planArguments("add_idea", {
        title: "Made-up quiz",
        pitch: "Rounds.",
        program: "social",
        inspiredBySlug: "2025-10-07-js-trivia-night-evt-2DtcNjNsqEqpgp6",
      }),
    ).toEqual([
      "idea",
      "add",
      "--title=Made-up quiz",
      "--pitch=Rounds.",
      "--program=social",
      "--inspired-by=2025-10-07-js-trivia-night-evt-2DtcNjNsqEqpgp6",
    ]);
  });

  test("null clears, and ids and queries follow --", () => {
    expect(
      planArguments("update_idea", {
        id: "f0000000-0000-4000-8000-000000000001",
        topic: null,
        eventSlug: "2026-09-01-draft-night",
      }),
    ).toEqual([
      "idea",
      "update",
      "--clear-topic",
      "--event=2026-09-01-draft-night",
      "--",
      "f0000000-0000-4000-8000-000000000001",
    ]);
    expect(planArguments("search_planning", { query: "-rf" })).toEqual([
      "search",
      "--",
      "-rf",
    ]);
  });

  test("topics and windows repeat their flags", () => {
    expect(
      planArguments("add_wanted_speaker", {
        name: "Made-up Person",
        topics: ["ai", "git"],
        availability: [{ startsOn: "2027-01-01", note: "free after Dec" }],
      }),
    ).toEqual([
      "speaker",
      "add",
      "--name=Made-up Person",
      "--topic=ai",
      "--topic=git",
      '--window={"startsOn":"2027-01-01","note":"free after Dec"}',
    ]);
  });

  test("input a schema refuses never reaches the CLI", () => {
    expect(() => planArguments("add_idea", { title: "No pitch" })).toThrow();
    expect(() =>
      planArguments("add_wanted_speaker", { name: "X", topics: [] }),
    ).toThrow();
  });
});

test("a value that starts with a dash stays the flag's value", () => {
  expect(
    planArguments("add_planning_note", {
      sponsor: "Acme",
      body: "--not a flag",
    }),
  ).toEqual(["note", "add", "--sponsor=Acme", "--body=--not a flag"]);
});
