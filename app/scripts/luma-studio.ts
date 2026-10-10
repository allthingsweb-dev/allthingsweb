import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** core/, whose luma tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * The admin MCP server's Luma tools (core/src/luma/publish.ts): make an
 * evening's Luma event private, fill it in, set its registration
 * (core/src/luma/registration.ts) and hosts (core/src/luma/hosts.ts), and
 * publish exactly what was approved. Each runs core's `bun run luma` with
 * --json, so the tools and the CLI never disagree. Writes default to a dry run; publishing needs
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
  luma_registration: z.object({
    event: z.string().min(1),
    approval: z.boolean().optional(),
    waitlist: z.boolean().optional(),
    capacity: z
      .union([z.number().int().positive(), z.literal("none")])
      .optional(),
    questions: z
      .array(z.object({ label: z.string().min(1), required: z.boolean() }))
      .optional(),
    // Left out, a dry run; true with approve is refused, never a write.
    dryRun: z.boolean().optional(),
    approve: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional(),
  }),
  luma_hosts: z.object({
    event: z.string().min(1),
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
    // Left out, a dry run; true with approve is refused, never a write.
    dryRun: z.boolean().optional(),
    approve: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional(),
  }),
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
  luma_registration: (input) => {
    const a = lumaSchemas.luma_registration.parse(input);
    const onOff = (on: boolean | undefined) =>
      on === undefined ? undefined : on ? "on" : "off";
    const changes = [
      ...flag("approval", onOff(a.approval)),
      ...flag("waitlist", onOff(a.waitlist)),
      ...flag("capacity", a.capacity),
      ...(a.questions === undefined
        ? []
        : a.questions.length === 0
          ? ["--clear-questions"]
          : a.questions.map(
              (q) => `--question${q.required ? "" : "-optional"}=${q.label}`,
            )),
    ];
    // Nothing to change is a read.
    if (changes.length === 0) {
      if (a.approve !== undefined) {
        throw new Error("approve needs the changes it was printed for.");
      }
      return ["registration", `--event=${a.event}`, "--json"];
    }
    if (a.dryRun === true && a.approve !== undefined) {
      throw new Error(
        "dryRun and approve can't both be given: a dry run writes nothing, approve writes.",
      );
    }
    if (a.dryRun === false && a.approve === undefined) {
      throw new Error(
        "A change needs approve: the token its dry run printed for an organizer to read.",
      );
    }
    return [
      "registration",
      `--event=${a.event}`,
      ...changes,
      ...(a.approve === undefined ? ["--dry-run"] : [`--approve=${a.approve}`]),
      "--json",
    ];
  },
  luma_hosts: (input) => {
    const a = lumaSchemas.luma_hosts.parse(input);
    const changes = [
      ...(a.add ?? []).map((who) => `--add=${who}`),
      ...(a.remove ?? []).map((who) => `--remove=${who}`),
    ];
    // Nothing to change is a read.
    if (changes.length === 0) {
      if (a.approve !== undefined) {
        throw new Error("approve needs the changes it was printed for.");
      }
      return ["hosts", `--event=${a.event}`, "--json"];
    }
    if (a.dryRun === true && a.approve !== undefined) {
      throw new Error(
        "dryRun and approve can't both be given: a dry run writes nothing, approve writes.",
      );
    }
    if (a.dryRun === false && a.approve === undefined) {
      throw new Error(
        "A change needs approve: the token its dry run printed for an organizer to read.",
      );
    }
    return [
      "hosts",
      `--event=${a.event}`,
      ...changes,
      ...(a.approve === undefined ? ["--dry-run"] : [`--approve=${a.approve}`]),
      "--json",
    ];
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
    name: "luma_registration",
    description:
      "An evening's registration on Luma: whether registering needs approval, the waitlist, capacity, and its questions in order, each required or optional. With no changes it reads. With changes it is a dry run: each change from what to what, anything Luma's API can't set (refused by name), and the approval token. With approve (that token), it makes exactly those changes and checks they took. A public event's change reaches guests at once: only on an organizer's explicit go.",
    inputSchema: {
      type: "object",
      properties: {
        event: string(
          "The evening: its draft's slug, its short link, or its Luma id",
        ),
        approval: {
          type: "boolean",
          description: "Whether registering needs an organizer's approval",
        },
        waitlist: {
          type: "boolean",
          description: "Whether a full event takes a waitlist",
        },
        capacity: {
          description: 'Most guests Luma takes, or "none" for no limit',
          oneOf: [{ type: "number" }, { type: "string", enum: ["none"] }],
        },
        questions: {
          type: "array",
          description:
            "The whole list of questions, in order; an empty list asks none",
          items: {
            type: "object",
            properties: {
              label: string("The question"),
              required: {
                type: "boolean",
                description: "Whether it must be answered",
              },
            },
            required: ["label", "required"],
          },
        },
        dryRun: dryRunProperty,
        approve: string(
          "The approval token the dry run printed for exactly these changes",
        ),
      },
      required: ["event"],
    },
  },
  {
    name: "luma_hosts",
    description:
      "An evening's hosts on Luma. With nothing to add or remove it lists them. With changes it is a dry run: who would be added (by email, as a manager shown on the page) or removed, anything Luma's API can't do (refused by name: adding by Luma user id, removing the event's creator), and the approval token. With approve (that token), it makes exactly those changes and checks they took. Only on an organizer's explicit go.",
    inputSchema: {
      type: "object",
      properties: {
        event: string(
          "The evening: its draft's slug, its short link, or its Luma id",
        ),
        add: {
          type: "array",
          items: { type: "string" },
          description: "Hosts to add, by email",
        },
        remove: {
          type: "array",
          items: { type: "string" },
          description: "Hosts to remove, by email or Luma user id (usr-…)",
        },
        dryRun: dryRunProperty,
        approve: string(
          "The approval token the dry run printed for exactly these changes",
        ),
      },
      required: ["event"],
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
