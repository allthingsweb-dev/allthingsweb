import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** core/, whose completeness report this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * Core's completeness report (core/src/completeness.ts) as JSON, for the
 * admin MCP server. It runs core's own script rather than porting the
 * rules, so the admin tool, the CLI and the weekly check can never
 * disagree. The script reads DATABASE_URL from this process's environment,
 * and only reads.
 */
export async function completenessReport(
  slug?: string,
): Promise<ReadonlyArray<{ readonly slug: string }>> {
  const { stdout } = await run(
    "bun",
    ["run", "--silent", "completeness", "--json"],
    {
      cwd: core,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
      // A stalled database fails the tool call instead of hanging it.
      timeout: 120_000,
    },
  );
  const reports = JSON.parse(stdout) as ReadonlyArray<{
    readonly slug: string;
  }>;
  if (slug === undefined) return reports;
  const found = reports.filter((report) => report.slug === slug);
  if (found.length === 0) {
    throw new Error(`No published event has the slug ${slug}`);
  }
  return found;
}
