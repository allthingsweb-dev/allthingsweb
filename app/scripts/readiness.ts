import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** core/, whose readiness tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

export const DraftReadinessSchema = z
  .object({
    slug: z.string().min(1).optional(),
    ideaId: z.string().min(1).optional(),
    topics: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (input) => (input.slug === undefined) !== (input.ideaId === undefined),
    {
      message: "Name one draft: slug or ideaId",
    },
  );

/** The `bun run readiness` arguments for `input`, each value one `--name=value`. */
export function readinessArguments(input: unknown): string[] {
  const args = DraftReadinessSchema.parse(input);
  return [
    ...(args.slug === undefined ? [] : [`--event=${args.slug}`]),
    ...(args.ideaId === undefined ? [] : [`--idea=${args.ideaId}`]),
    ...(args.topics ?? []).map((topic) => `--topic=${topic}`),
    "--json",
  ];
}

/**
 * Core's readiness report for a draft evening (core/src/readiness/), for
 * the admin MCP server: the completeness rules ahead of time, and
 * suggested speakers, hosts and dates. It runs core's own script, so the
 * tool and the CLI never disagree. The script exits 1 when something
 * blocks publishing, with the report still on stdout; a refusal (no such
 * draft) fails with core's reason. It only reads; as the studio (core's
 * README, "The studio's connection") it also suggests planning's wanted
 * speakers and host prospects.
 */
export async function draftReadiness(input: unknown): Promise<unknown> {
  const args = readinessArguments(input);
  try {
    const { stdout } = await run(
      "bun",
      ["run", "--silent", "readiness", ...args],
      {
        cwd: core,
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
        // A stalled database fails the tool call instead of hanging it.
        timeout: 120_000,
      },
    );
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const failed = error as {
      code?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    if (
      failed.code === 1 &&
      typeof failed.stdout === "string" &&
      failed.stdout !== ""
    ) {
      return JSON.parse(failed.stdout) as unknown;
    }
    const stderr =
      typeof failed.stderr === "string" ? failed.stderr.trim() : "";
    throw new Error(stderr === "" ? String(error) : stderr, { cause: error });
  }
}

export const draftReadinessTool = {
  name: "get_draft_readiness",
  description:
    "Whether a draft evening is ready to publish, and what to add. Name the draft by slug (an event the Luma sync stored as a draft) or by ideaId (planning; through its draft evening when it has one). Checks run the completeness rules ahead of time (lineup with bios and photos, people, hosts, venue, topic, tagline, cover once the Luma event exists) plus the date (ahead, sane, clear of other evenings that day), the venue's name and neighborhood, and a hackathon's schedule; each is a blocker or advice. Suggestions: network speakers ranked by how many of the evening's words their past talks share and how recently they spoke, wanted speakers free that day, host prospects, hosts not used in 90 days, open dates on our usual weekdays, and the guest count of the evening it builds on. topics adds words to match. Read-only; planning rows join only as the studio or the database owner and are private.",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "The draft evening's slug" },
      ideaId: { type: "string", description: "An idea's id, from planning" },
      topics: {
        type: "array",
        items: { type: "string" },
        description:
          'More words to match suggestions on, e.g. ["javascript", "git"]',
      },
    },
    required: [],
  },
} as const;
