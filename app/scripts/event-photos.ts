import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** core/, whose photos tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * Adds photos to an evening with core's photos tool (core/src/photos.ts),
 * for the admin MCP server. It runs core's own script, so the tool and the
 * CLI encode, key, store and order photos the same way. The script reads
 * DATABASE_URL, MEDIA_UPLOAD_URL and MEDIA_UPLOAD_TOKEN from this process's
 * environment.
 */
export async function addEventPhotos(args: {
  slug: string;
  files: Array<string>;
  alts: Array<string>;
  dryRun?: boolean;
}): Promise<unknown> {
  if (args.files.length !== args.alts.length) {
    throw new Error(
      `${args.files.length} files but ${args.alts.length} alt texts: give one per file, in order.`,
    );
  }
  const { stdout } = await run(
    "bun",
    [
      "run",
      "--silent",
      "photos",
      "add",
      ...args.alts.flatMap((alt) => ["--alt", alt]),
      ...(args.dryRun === true ? ["--dry-run"] : []),
      "--json",
      "--",
      args.slug,
      ...args.files,
    ],
    {
      cwd: core,
      env: process.env,
      maxBuffer: 1024 * 1024,
      // Encoding and uploading a dozen camera photos takes a while; a
      // stalled upload or database still fails the call instead of hanging.
      timeout: 10 * 60_000,
    },
  );
  return JSON.parse(stdout) as unknown;
}
