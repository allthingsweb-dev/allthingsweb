import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** core/, whose luma tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * The admin MCP server's Luma tools (core/src/luma/publish.ts): make an
 * evening's Luma event private, fill it in, and publish exactly what was
 * approved. Each runs core's `bun run luma` with --json, so the tools and
 * the CLI never disagree. Writes default to a dry run; publishing needs
 * the approval token that `luma_prepare_publish` printed for what an
 * organizer read and approved. The script reads LUMA_API_KEY and
 * DATABASE_URL from this process's environment.
 */

const place = {
  venue: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
};

export const lumaSchemas = {
  luma_create_event: z.object({
    name: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    ...place,
    ideaId: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    capacity: z.number().int().positive().optional(),
    dryRun: z.boolean().default(true),
  }),
  luma_update_event: z.object({
    slug: z.string().min(1).optional(),
    lumaEventId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    start: z.string().min(1).optional(),
    end: z.string().min(1).optional(),
    ...place,
    descriptionFromDrafts: z.boolean().optional(),
    coverPath: z.string().min(1).optional(),
    dryRun: z.boolean().default(true),
  }),
  luma_prepare_publish: z.object({ slug: z.string().min(1) }),
  luma_publish: z.object({
    slug: z.string().min(1),
    approve: z.string().regex(/^[0-9a-f]{16}$/),
  }),
  luma_show_event: z.object({ lumaEventId: z.string().min(1) }),
} as const;

export type LumaTool = keyof typeof lumaSchemas;

export const isLumaTool = (name: string): name is LumaTool =>
  Object.hasOwn(lumaSchemas, name);

const flag = (name: string, value: string | number | undefined): string[] =>
  value === undefined ? [] : [`--${name}=${value}`];

const builders: { readonly [T in LumaTool]: (input: unknown) => string[] } = {
  luma_create_event: (input) => {
    const a = lumaSchemas.luma_create_event.parse(input);
    return [
      "create",
      ...flag("name", a.name),
      ...flag("start", a.start),
      ...flag("end", a.end),
      ...flag("venue", a.venue),
      ...flag("address", a.address),
      ...flag("idea", a.ideaId),
      ...flag("slug", a.slug),
      ...flag("capacity", a.capacity),
      ...(a.dryRun ? ["--dry-run"] : []),
      "--json",
    ];
  },
  luma_update_event: (input) => {
    const a = lumaSchemas.luma_update_event.parse(input);
    return [
      "update",
      ...flag("event", a.slug),
      ...flag("luma", a.lumaEventId),
      ...flag("name", a.name),
      ...flag("start", a.start),
      ...flag("end", a.end),
      ...flag("venue", a.venue),
      ...flag("address", a.address),
      ...(a.descriptionFromDrafts === true
        ? ["--description-from-drafts"]
        : []),
      ...flag("cover", a.coverPath),
      ...(a.dryRun ? ["--dry-run"] : []),
      "--json",
    ];
  },
  luma_prepare_publish: (input) => {
    const a = lumaSchemas.luma_prepare_publish.parse(input);
    return ["publish", "--dry-run", "--json", "--", a.slug];
  },
  luma_publish: (input) => {
    const a = lumaSchemas.luma_publish.parse(input);
    return ["publish", `--approve=${a.approve}`, "--json", "--", a.slug];
  },
  luma_show_event: (input) => {
    const a = lumaSchemas.luma_show_event.parse(input);
    return ["show", "--", a.lumaEventId];
  },
};

/** The `bun run luma` arguments for `tool` with `input`, which it checks first. */
export const lumaArguments = (tool: LumaTool, input: unknown): string[] =>
  builders[tool](input);

/** Runs `tool`, returning core's JSON; a refusal fails with core's reason. */
export async function lumaTool(
  tool: LumaTool,
  input: unknown,
): Promise<unknown> {
  try {
    const { stdout } = await run(
      "bun",
      ["run", "--silent", "luma", ...lumaArguments(tool, input)],
      {
        cwd: core,
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
        // A stalled Luma or database fails the call instead of hanging it.
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

const string = (description: string) => ({ type: "string", description });
const dryRunProperty = {
  type: "boolean",
  description:
    "Print what would be sent to Luma and send nothing (true by default)",
};

/** The tools as the MCP server lists them. */
export const lumaToolDefinitions: ReadonlyArray<{
  name: LumaTool;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}> = [
  {
    name: "luma_create_event",
    description:
      "Make an evening's Luma event, private (never public), in San Francisco's time zone; with ideaId, the idea's pitch is its first description. A dry run unless dryRun is false. Making an event on Luma for real needs an organizer's go.",
    inputSchema: {
      type: "object",
      properties: {
        name: string("The evening's name on Luma"),
        start: string(
          "When it starts, with its offset, e.g. 2026-11-18T18:00:00-08:00",
        ),
        end: string("When it ends, with its offset"),
        venue: string(
          'The place as Google Maps finds it, e.g. "CodeRabbit, 201 Spear St"',
        ),
        address: string(
          "The address as written, when Google Maps has no place for it",
        ),
        ideaId: string("The idea it comes from, from planning"),
        slug: string("Its address on Luma (luma.com/<slug>)"),
        capacity: { type: "number", description: "Most guests Luma takes" },
        dryRun: dryRunProperty,
      },
      required: ["name", "start", "end"],
    },
  },
  {
    name: "luma_update_event",
    description:
      "Change a private Luma event, by its draft's slug or its Luma id: name, times, place, the description the promotion drafts write (descriptionFromDrafts, needs slug), a cover (a PNG or JPEG path). A public event is refused. A dry run unless dryRun is false.",
    inputSchema: {
      type: "object",
      properties: {
        slug: string("The draft, by its slug"),
        lumaEventId: string(
          "The event, by its Luma id, before the sync has stored it",
        ),
        name: string("A new name"),
        start: string("When it starts, with its offset"),
        end: string("When it ends, with its offset"),
        venue: string("The place as Google Maps finds it"),
        address: string("The address as written"),
        descriptionFromDrafts: {
          type: "boolean",
          description: "Set the description the promotion drafts write",
        },
        coverPath: string("A PNG or JPEG file to upload as its cover"),
        dryRun: dryRunProperty,
      },
      required: [],
    },
  },
  {
    name: "luma_prepare_publish",
    description:
      "Exactly what publishing a draft would put out on Luma (name, times, place, cover, the description in full) and its approval token. Refuses while readiness finds a blocker. Sends nothing.",
    inputSchema: {
      type: "object",
      properties: { slug: string("The draft's slug") },
      required: ["slug"],
    },
  },
  {
    name: "luma_publish",
    description:
      "Make a draft's Luma event public with exactly the content an organizer approved: approve is the token luma_prepare_publish printed for it, and anything changed since is refused. Only on an organizer's explicit go.",
    inputSchema: {
      type: "object",
      properties: {
        slug: string("The draft's slug"),
        approve: string("The approval token for what was read and approved"),
      },
      required: ["slug", "approve"],
    },
  },
  {
    name: "luma_show_event",
    description: "A Luma event as our calendar sees it. Read-only.",
    inputSchema: {
      type: "object",
      properties: { lumaEventId: string("The event's Luma id, evt-…") },
      required: ["lumaEventId"],
    },
  },
];
