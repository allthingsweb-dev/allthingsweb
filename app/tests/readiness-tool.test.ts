import { describe, expect, test } from "bun:test";
import { draftReadinessTool, readinessArguments } from "../scripts/readiness";

/**
 * get_draft_readiness (scripts/readiness.ts) as core's `bun run readiness`
 * reads it; core tests the report itself (tests/readiness.test.ts).
 */
describe("get_draft_readiness", () => {
  test("a draft by slug, with words to match, each one argument", () => {
    expect(
      readinessArguments({
        slug: "2026-04-29-js-trivia-night",
        topics: ["git", "-x"],
      }),
    ).toEqual([
      "--event=2026-04-29-js-trivia-night",
      "--topic=git",
      "--topic=-x",
      "--json",
    ]);
  });

  test("an idea by id", () => {
    expect(
      readinessArguments({ ideaId: "f0000000-0000-4000-8000-000000000001" }),
    ).toEqual(["--idea=f0000000-0000-4000-8000-000000000001", "--json"]);
  });

  test("exactly one draft", () => {
    expect(() => readinessArguments({})).toThrow("Name one draft");
    expect(() => readinessArguments({ slug: "a", ideaId: "b" })).toThrow(
      "Name one draft",
    );
  });

  test("lists what it takes", () => {
    expect(
      Object.keys(draftReadinessTool.inputSchema.properties).toSorted(),
    ).toEqual(["ideaId", "slug", "topics"]);
  });
});
