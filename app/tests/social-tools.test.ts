import { describe, expect, test } from "bun:test";
import {
  socialArguments,
  socialSchemas,
  socialToolDefinitions,
} from "../scripts/social";

/**
 * The admin MCP server's posting tools (scripts/social.ts) as core's
 * `bun run social` reads them; core tests what they do
 * (tests/social-bluesky.test.ts).
 */
describe("posting tools", () => {
  test("each tool lists the inputs its schema takes", () => {
    expect(
      socialToolDefinitions.map((tool): string => tool.name).toSorted(),
    ).toEqual(Object.keys(socialSchemas).toSorted());
    for (const definition of socialToolDefinitions) {
      const shape = socialSchemas[definition.name].shape as Record<
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

  test("preparing is a dry run; posting takes a token, and only one", () => {
    const post = { channel: "bluesky", slug: "evening", moment: "announce" };
    expect(socialArguments("social_prepare_post", post)).toEqual([
      "bluesky",
      "--moment=announce",
      "--dry-run",
      "--json",
      "--",
      "evening",
    ]);
    expect(
      socialArguments("social_post", { ...post, approve: "0123456789abcdef" }),
    ).toEqual([
      "bluesky",
      "--moment=announce",
      "--approve=0123456789abcdef",
      "--json",
      "--",
      "evening",
    ]);
    expect(() => socialArguments("social_post", post)).toThrow();
    expect(() =>
      socialArguments("social_post", { ...post, approve: "yes" }),
    ).toThrow();
    expect(() =>
      socialArguments("social_prepare_post", { ...post, channel: "myspace" }),
    ).toThrow();
  });
});
