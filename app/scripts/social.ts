import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** core/, whose social tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * The admin MCP server's posting tools (core/src/social/): an evening's
 * promotion draft, posted from our accounts exactly as an organizer
 * approved it. `social_prepare_post` reads only and prints the post and
 * its approval token; `social_post` posts that, once, and only with that
 * token. Each runs core's `bun run social` with --json, so the tools and
 * the CLI never disagree.
 */

export const socialChannels = ["bluesky", "discord"] as const;
const moments = ["announce", "dayOf", "recap"] as const;

export const socialSchemas = {
  social_prepare_post: z.object({
    channel: z.enum(socialChannels),
    slug: z.string().min(1),
    moment: z.enum(moments),
  }),
  social_post: z.object({
    channel: z.enum(socialChannels),
    slug: z.string().min(1),
    moment: z.enum(moments),
    approve: z.string().regex(/^[0-9a-f]{16}$/),
  }),
} as const;

export type SocialTool = keyof typeof socialSchemas;

export const isSocialTool = (name: string): name is SocialTool =>
  Object.hasOwn(socialSchemas, name);

/** The `bun run social` arguments for `tool` with `input`, which it checks first. */
export function socialArguments(tool: SocialTool, input: unknown): string[] {
  if (tool === "social_prepare_post") {
    const a = socialSchemas.social_prepare_post.parse(input);
    return [
      a.channel,
      `--moment=${a.moment}`,
      "--dry-run",
      "--json",
      "--",
      a.slug,
    ];
  }
  const a = socialSchemas.social_post.parse(input);
  return [
    a.channel,
    `--moment=${a.moment}`,
    `--approve=${a.approve}`,
    "--json",
    "--",
    a.slug,
  ];
}

/** Runs `tool`, returning core's JSON; a refusal fails with core's reason. */
export async function socialTool(
  tool: SocialTool,
  input: unknown,
): Promise<unknown> {
  try {
    const { stdout } = await run(
      "bun",
      ["run", "--silent", "social", ...socialArguments(tool, input)],
      {
        cwd: core,
        env: process.env,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120_000,
      },
    );
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(stderr === "" ? String(error) : stderr, { cause: error });
  }
}

const common = {
  channel: {
    type: "string",
    enum: [...socialChannels],
    description:
      "Where: bluesky (@allthingsweb.dev), or discord (our server, through its channel webhook)",
  },
  slug: { type: "string", description: "The published evening's slug" },
  moment: {
    type: "string",
    enum: [...moments],
    description: "Which draft: announce, dayOf or recap",
  },
};

export const socialToolDefinitions: ReadonlyArray<{
  name: SocialTool;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}> = [
  {
    name: "social_prepare_post",
    description:
      "The exact post an evening's promotion draft makes on a platform (text, links and mentions; for Discord, the channel it goes to), whether it already went out, and its approval token. Read-only: posts nothing.",
    inputSchema: {
      type: "object",
      properties: common,
      required: ["channel", "slug", "moment"],
    },
  },
  {
    name: "social_post",
    description:
      "Post exactly what an organizer approved, once: approve is the token social_prepare_post printed for it, and anything changed since is refused, as is a post already out (or, on Discord, a send that went unanswered, until an organizer settles it with the CLI: --sent or --release). Only on an organizer's explicit go.",
    inputSchema: {
      type: "object",
      properties: {
        ...common,
        approve: {
          type: "string",
          description: "The approval token for what was read and approved",
        },
      },
      required: ["channel", "slug", "moment", "approve"],
    },
  },
];
