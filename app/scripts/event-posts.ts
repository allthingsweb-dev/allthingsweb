import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** core/, whose posts tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * Adds a post about an event with core's posts tool (core/src/posts/), for
 * the admin MCP server. It runs core's own script, so the tool, the CLI and
 * backfills resolve, store and deduplicate posts the same way. The script
 * reads DATABASE_URL from this process's environment.
 */
export async function addEventPost(args: {
  slug: string;
  url: string;
  authorName?: string;
  authorUrl?: string;
  text?: string;
}): Promise<unknown> {
  const flags = [
    ...(args.authorName === undefined
      ? []
      : ["--author-name", args.authorName]),
    ...(args.authorUrl === undefined ? [] : ["--author-url", args.authorUrl]),
    ...(args.text === undefined ? [] : ["--text", args.text]),
  ];
  const { stdout } = await run(
    "bun",
    [
      "run",
      "--silent",
      "posts",
      "add",
      ...flags,
      "--json",
      "--",
      args.slug,
      args.url,
    ],
    {
      cwd: core,
      env: process.env,
      maxBuffer: 1024 * 1024,
      // A stalled platform or database fails the call instead of hanging it.
      timeout: 60_000,
    },
  );
  return JSON.parse(stdout) as unknown;
}
