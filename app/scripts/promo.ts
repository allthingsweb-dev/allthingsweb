import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** core/, whose promo tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/** Where a draft goes, as core's promo tool names it (core/src/promo/format.ts). */
export const promoChannels = [
  "luma",
  "meetup",
  "x",
  "bluesky",
  "linkedin",
  "discord",
] as const;

export type PromoChannel = (typeof promoChannels)[number];

/**
 * An evening's promotion drafts from core's promo tool (core/src/promo/),
 * for the admin MCP server: as text to read and copy from, or as JSON with
 * each draft's length. It runs core's own script, so the tool and the CLI
 * can never draft differently. The script reads DATABASE_URL from this
 * process's environment, only reads, and posts nothing.
 */
export async function promoDrafts(args: {
  slug: string;
  channels?: ReadonlyArray<PromoChannel>;
  json?: boolean;
}): Promise<string> {
  const { stdout } = await run(
    "bun",
    [
      "run",
      "--silent",
      "promo",
      ...(args.channels ?? []).flatMap((channel) => ["--channel", channel]),
      ...(args.json === true ? ["--json"] : []),
      "--",
      args.slug,
    ],
    {
      cwd: core,
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
      // A stalled database fails the tool call instead of hanging it.
      timeout: 60_000,
    },
  );
  return stdout;
}
