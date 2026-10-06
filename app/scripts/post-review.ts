import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** core/, whose posts tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * Reviewing posts a search found (core/src/posts/candidates.ts), for the
 * admin MCP server: list the pending ones, approve or hide each. It runs
 * core's own script, so the tools and the CLI review the same way. The
 * script reads DATABASE_URL from this process's environment.
 */
const posts = async (
  args: ReadonlyArray<string>,
  url?: string,
): Promise<unknown> => {
  const { stdout } = await run(
    "bun",
    [
      "run",
      "--silent",
      "posts",
      ...args,
      "--json",
      // A URL goes after "--", so one starting with "-" is never a flag.
      ...(url === undefined ? [] : ["--", url]),
    ],
    {
      cwd: core,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
      // A stalled database fails the call instead of hanging it.
      timeout: 60_000,
    },
  );
  return JSON.parse(stdout) as unknown;
};

/** Pending posts, an evening's or every one. */
export const listPendingPosts = (slug?: string) =>
  posts(["pending", ...(slug === undefined ? [] : ["--slug", slug])]);

/** Approves the post at `url`: it shows on its evening's page. */
export const approvePost = (url: string) => posts(["approve"], url);

/** Hides the post at `url`: it never shows. */
export const hidePost = (url: string) => posts(["hide"], url);
