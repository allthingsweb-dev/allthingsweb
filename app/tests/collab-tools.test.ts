import { describe, expect, test } from "bun:test";
import {
  type CollabTool,
  collabArguments,
  collabSchemas,
  collabToolDefinitions,
  collabTools,
} from "../scripts/collab";
import { planTools } from "../scripts/plan";

/**
 * The admin MCP server's collaboration tools (scripts/collab.ts) as core's
 * `bun run collab` reads them, and that no tool returns a round's
 * answers. That the CLI takes each tool's arguments is tested in core
 * (tests/collab-tools.test.ts), whose CI installs it; what it does with
 * them, in tests/collab-cli.test.ts.
 */

const id = "f0000000-0000-4000-8000-000000000001";
const slug = "2026-10-27-allthings-trivia-evt-X4AFYwHLdOdGtMh";

/** An input for each tool, every field it takes filled in. */
const samples: { readonly [T in CollabTool]: unknown } = {
  collab_invite: {
    slug,
    email: "simon@example.com",
    name: "Simon",
    role: "round_host",
    round: 5,
    approve: "0123456789abcdef",
  },
  collab_revoke: {
    slug,
    email: "simon@example.com",
    approve: "0123456789abcdef",
  },
  collab_list: { slug },
  collab_round_add: {
    slug,
    position: 5,
    title: "AI",
    questions: 8,
    backups: 1,
    dryRun: true,
  },
  collab_round_list: { slug },
  collab_brief_set: { slug, from: "brief.md", approve: "0123456789abcdef" },
  collab_brief_show: { slug },
  collab_task_add: {
    slug,
    title: "First drafts",
    due: "2026-10-20",
    role: "round_host",
    dryRun: true,
  },
  collab_task_done: { id, dryRun: true },
  collab_task_list: { slug },
  collab_logistics_add: {
    slug,
    position: 1,
    label: "HDMI",
    detail: "A spare too",
    dryRun: true,
  },
  collab_logistics_list: { slug },
  collab_submissions: { slug },
  collab_review: {
    subject: "round",
    id,
    decision: "changes_requested",
    reviewer: "Erik",
    note: "Q3 has two answers.",
    approve: "0123456789abcdef",
  },
  collab_show: { id, out: "show.md" },
  collab_export: { slug, round: 5, out: "round-5.md" },
  collab_comments: { slug },
  collab_comment_hide: { id, dryRun: true },
  collab_audit: { slug, limit: 50 },
  collab_access_sync: { dryRun: true },
  collab_access_end_sessions: { email: "gone@example.com" },
};

describe("collaboration tools", () => {
  test("each tool is listed once, with the inputs its schema takes", () => {
    expect(collabToolDefinitions.map((tool) => tool.name)).toEqual([
      ...collabTools,
    ]);
    for (const definition of collabToolDefinitions) {
      const shape = collabSchemas[definition.name].shape as Record<
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

  test("no name is another tool's", () => {
    for (const name of collabTools) {
      expect(planTools as ReadonlyArray<string>).not.toContain(name);
    }
  });

  test("fields become flags, and positionals follow --", () => {
    expect(collabArguments("collab_invite", samples.collab_invite)).toEqual([
      "invite",
      "--email=simon@example.com",
      "--name=Simon",
      "--role=round_host",
      "--round=5",
      "--approve=0123456789abcdef",
      "--",
      slug,
    ]);
    expect(collabArguments("collab_review", samples.collab_review)).toEqual([
      "review",
      "--decision=changes_requested",
      "--reviewer=Erik",
      "--note=Q3 has two answers.",
      "--approve=0123456789abcdef",
      "--",
      "round",
      id,
    ]);
    // A slug that looks like a flag stays the slug.
    expect(collabArguments("collab_list", { slug: "--json" })).toEqual([
      "list",
      "--",
      "--json",
    ]);
  });

  test("no tool returns a round's answers: opening one always writes a file", () => {
    for (const tool of ["collab_show", "collab_export"] as const) {
      const args = collabArguments(tool, samples[tool]);
      expect(args).not.toContain("--stdout");
      expect(args.some((arg) => arg.startsWith("--out="))).toBe(true);
      expect(() =>
        collabArguments(tool, { ...(samples[tool] as object), out: undefined }),
      ).toThrow();
    }
  });

  test("a value the CLI can't take is refused before it runs", () => {
    expect(() =>
      collabArguments("collab_invite", {
        ...(samples.collab_invite as object),
        role: "owner",
      }),
    ).toThrow();
    expect(() =>
      collabArguments("collab_round_add", {
        ...(samples.collab_round_add as object),
        position: 1.5,
      }),
    ).toThrow();
  });
});
