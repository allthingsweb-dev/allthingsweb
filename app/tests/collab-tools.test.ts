import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
 * `bun run collab` reads them. What the CLI does is tested in core
 * (tests/collab-cli.test.ts); here, that each tool's arguments are ones
 * the CLI takes, and that no tool returns a round's answers.
 */

const core = fileURLToPath(new URL("../../core/", import.meta.url));
const files = await mkdtemp(join(tmpdir(), "collab-tools-"));
const brief = join(files, "brief.md");
await writeFile(brief, "## The pitch\n<!-- for: viewer -->\nHard.\n");
afterAll(() => rm(files, { recursive: true, force: true }));

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
  collab_brief_set: { slug, from: brief, approve: "0123456789abcdef" },
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
  collab_show: { id, out: join(files, "show.md") },
  collab_export: { slug, round: 5, out: join(files, "round-5.md") },
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

  // Each tool's arguments, as core's CLI parses them: with no database, a
  // command it understands stops at the database (or the key it needs
  // first), never at its usage.
  for (const tool of collabTools) {
    test(`bun run collab takes ${tool}'s arguments`, async () => {
      const args = collabArguments(tool, samples[tool]);
      const end = args.indexOf("--");
      const withJson =
        end === -1
          ? [...args, "--json"]
          : [...args.slice(0, end), "--json", ...args.slice(end)];
      const env: Record<string, string> = { ...process.env } as Record<
        string,
        string
      >;
      delete env["DATABASE_URL"];
      delete env["CLOUDFLARE_ZERO_TRUST_TOKEN"];
      delete env["COLLAB_ANSWERS_KEY"];
      const child = Bun.spawn(
        ["bun", "run", "--silent", "collab", ...withJson],
        {
          cwd: core,
          env,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const said = `${stdout}${stderr}`;
      expect(said).not.toContain("USAGE");
      expect(
        [
          "DATABASE_URL",
          "COLLAB_ANSWERS_KEY is not set",
          "CLOUDFLARE_ZERO_TRUST_TOKEN is not set",
        ].some((stop) => said.includes(stop)),
      ).toBe(true);
    });
  }
});
