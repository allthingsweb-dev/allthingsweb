import { describe, expect, test } from "bun:test";
import {
  lumaArguments,
  lumaSchemas,
  lumaToolDefinitions,
} from "../scripts/luma-studio";

/**
 * The admin MCP server's Luma tools (scripts/luma-studio.ts) as core's
 * `bun run luma` reads them; core tests what they do
 * (tests/luma-studio.test.ts).
 */
describe("Luma tools", () => {
  test("each tool lists the inputs its schema takes", () => {
    expect(lumaToolDefinitions.map((tool) => tool.name).toSorted()).toEqual(
      Object.keys(lumaSchemas).toSorted(),
    );
    for (const definition of lumaToolDefinitions) {
      const shape = lumaSchemas[definition.name].shape as Record<
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

  test("writes are dry runs unless asked otherwise", () => {
    const create = {
      name: "All Things Made Up",
      start: "2026-11-18T18:00:00-08:00",
      end: "2026-11-18T21:00:00-08:00",
      venue: "CodeRabbit, 201 Spear St",
    };
    expect(lumaArguments("luma_create_event", create)).toEqual([
      "create",
      "--name=All Things Made Up",
      "--start=2026-11-18T18:00:00-08:00",
      "--end=2026-11-18T21:00:00-08:00",
      "--venue=CodeRabbit, 201 Spear St",
      "--dry-run",
      "--json",
    ]);
    expect(
      lumaArguments("luma_create_event", { ...create, dryRun: false }),
    ).not.toContain("--dry-run");
    expect(
      lumaArguments("luma_update_event", {
        slug: "x",
        descriptionFromDrafts: true,
      }),
    ).toEqual([
      "update",
      "--event=x",
      "--description-from-drafts",
      "--dry-run",
      "--json",
    ]);
  });

  test("publishing takes an approval token, and only one", () => {
    expect(lumaArguments("luma_prepare_publish", { slug: "draft" })).toEqual([
      "publish",
      "--dry-run",
      "--json",
      "--",
      "draft",
    ]);
    expect(
      lumaArguments("luma_publish", {
        slug: "draft",
        approve: "0123456789abcdef",
      }),
    ).toEqual([
      "publish",
      "--approve=0123456789abcdef",
      "--json",
      "--",
      "draft",
    ]);
    expect(() => lumaArguments("luma_publish", { slug: "draft" })).toThrow();
    expect(() =>
      lumaArguments("luma_publish", { slug: "draft", approve: "yes" }),
    ).toThrow();
  });
});
