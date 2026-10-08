import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CollabTool,
  collabArguments,
  collabTools,
} from "../../app/scripts/collab.ts";

/**
 * The admin MCP server's collaboration tools (app/scripts/collab.ts), as
 * this CLI (scripts/collab.ts) parses their arguments. It runs here, not in
 * the app's tests, because the app's CI installs only the app: core's CLI
 * can't start there. What each command does is tests/collab-cli.test.ts.
 */

const core = fileURLToPath(new URL("../", import.meta.url));
const files = await mkdtemp(join(tmpdir(), "collab-tools-"));
const brief = join(files, "brief.md");
await writeFile(brief, "## The pitch\n<!-- for: viewer -->\nHard.\n");
afterAll(() => rm(files, { recursive: true, force: true }));

const id = "f0000000-0000-4000-8000-000000000001";
const slug = "2026-10-27-allthings-trivia-evt-X4AFYwHLdOdGtMh";
const approve = "0123456789abcdef";

/** An input for each tool, every field it takes filled in. */
const samples: { readonly [T in CollabTool]: unknown } = {
  collab_invite: {
    slug,
    email: "simon@example.com",
    name: "Simon",
    role: "round_host",
    round: 5,
    approve,
  },
  collab_revoke: { slug, email: "simon@example.com", approve },
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
  collab_brief_set: { slug, from: brief, approve },
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
    approve,
  },
  collab_show: { id, out: join(files, "show.md") },
  collab_export: { slug, round: 5, out: join(files, "round-5.md") },
  collab_comments: { slug },
  collab_comment_hide: { id, dryRun: true },
  collab_audit: { slug, limit: 50 },
  collab_access_sync: { dryRun: true },
  collab_access_end_sessions: { email: "gone@example.com" },
};

// With no database, a command the CLI understands stops at the database
// (or the key it needs first), never at its usage.
describe("bun run collab takes", () => {
  for (const tool of collabTools) {
    test(`${tool}'s arguments`, async () => {
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
        { cwd: core, env, stdout: "pipe", stderr: "pipe" },
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
