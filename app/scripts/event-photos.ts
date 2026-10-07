import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** core/, whose photos tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * The reason a run of the photos tool gave for failing: the message of the
 * error it logged (Effect logs it to stdout), else whatever it printed.
 */
export function failureReason(output: string): string | undefined {
  const logged = output
    .split("\n")
    .map((line) => /\bERROR \(#\d+\): (?:\w+: )?(.+)$/.exec(line)?.[1])
    .filter((reason) => reason !== undefined);
  if (logged.length > 0) return logged.join("\n");
  const printed = output.trim();
  return printed === "" ? undefined : printed;
}

/**
 * Runs `bun run photos …args` in core/ and parses the JSON it prints. A
 * failed run throws the tool's own reason, such as a refused approval, not
 * just the command line. It reads DATABASE_URL (and, to store photos,
 * MEDIA_UPLOAD_URL and MEDIA_UPLOAD_TOKEN) from this process's environment.
 */
async function photos(
  args: ReadonlyArray<string>,
  timeout: number,
): Promise<unknown> {
  try {
    const { stdout } = await run(
      "bun",
      ["run", "--silent", "photos", ...args],
      {
        cwd: core,
        env: process.env,
        maxBuffer: 1024 * 1024,
        timeout,
      },
    );
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const { stdout = "", stderr = "" } = error as {
      stdout?: string;
      stderr?: string;
    };
    const reason = failureReason(`${stdout}\n${stderr}`);
    if (reason === undefined) throw error;
    throw new Error(reason, { cause: error });
  }
}

/**
 * Adds photos to an evening with core's photos tool (core/src/photos.ts),
 * for the admin MCP server. It runs core's own script, so the tool and the
 * CLI encode, key, store and order photos the same way.
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
  return photos(
    [
      "add",
      ...args.alts.flatMap((alt) => ["--alt", alt]),
      ...(args.dryRun === true ? ["--dry-run"] : []),
      "--json",
      "--",
      args.slug,
      ...args.files,
    ],
    // Encoding and uploading a dozen camera photos takes a while; a stalled
    // upload or database still fails the call instead of hanging.
    10 * 60_000,
  );
}

/**
 * Replaces one of an evening's photos in its place with core's photos tool
 * (`photos replace`). `photo` is the old photo's image id, or its position
 * on the page from 1. The old object stays in the bucket.
 */
export async function replaceEventPhoto(args: {
  slug: string;
  photo: string;
  file: string;
  alt: string;
  dryRun?: boolean;
}): Promise<unknown> {
  return photos(
    [
      "replace",
      "--alt",
      args.alt,
      ...(args.dryRun === true ? ["--dry-run"] : []),
      "--json",
      "--",
      args.slug,
      args.photo,
      args.file,
    ],
    5 * 60_000,
  );
}

/**
 * An evening's photos in the order its page shows them, each with its
 * position (from 1) and image id, with core's photos tool (`photos list`).
 * Reads only.
 */
export async function listEventPhotos(args: {
  slug: string;
}): Promise<unknown> {
  return photos(["list", "--json", "--", args.slug], 60_000);
}

/**
 * Removes one of an evening's photos with core's photos tool
 * (`photos remove`). Without `approve` it is a dry run: it says exactly what
 * would change and returns the approval token for it. With the token, it
 * makes exactly that change, or refuses if anything moved since. `photo` is
 * the image id, or its position on the page from 1. The object stays in the
 * bucket.
 */
export async function removeEventPhoto(args: {
  slug: string;
  photo: string;
  approve?: string;
}): Promise<unknown> {
  return photos(
    [
      "remove",
      ...(args.approve === undefined
        ? ["--dry-run"]
        : ["--approve", args.approve]),
      "--json",
      "--",
      args.slug,
      args.photo,
    ],
    60_000,
  );
}
