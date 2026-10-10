import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** core/, whose planning tool this runs. */
const core = fileURLToPath(new URL("../../core/", import.meta.url));

/**
 * The admin MCP server's planning tools: ideas for evenings, speakers we'd
 * like and when they're free, companies we'd like to host, and notes
 * (core/src/planning/). Each tool runs core's `bun run plan` with --json,
 * so the tools and the CLI can never disagree, and core checks every value
 * (topics, days, statuses) before anything is written. The script reads
 * DATABASE_URL from this process's environment; planning needs the
 * studio's connection (core's README, "The studio's connection"), since no
 * site role may use it.
 *
 * The rows are private: tool results are for organizers, never for a
 * page, a post or a file in the repository.
 */

const programs = ["talks", "open-floor", "social", "hackathon"] as const;
const ideaStatuses = ["idea", "drafting", "scheduled", "dropped"] as const;
const speakerStatuses = ["wanted", "asked", "confirmed", "declined"] as const;
const hostStatuses = ["prospect", "asked", "confirmed", "declined"] as const;

const Window = z.object({
  kind: z.enum(["available", "unavailable"]).optional(),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
  note: z.string().optional(),
});

export const planSchemas = {
  add_idea: z.object({
    title: z.string(),
    pitch: z.string(),
    program: z.enum(programs),
    topic: z.string().optional(),
    status: z.enum(ideaStatuses).optional(),
    eventSlug: z.string().optional(),
    inspiredBySlug: z.string().optional(),
  }),
  list_ideas: z.object({ status: z.enum(ideaStatuses).optional() }),
  update_idea: z.object({
    id: z.string(),
    title: z.string().optional(),
    pitch: z.string().optional(),
    program: z.enum(programs).optional(),
    topic: z.string().nullable().optional(),
    status: z.enum(ideaStatuses).optional(),
    eventSlug: z.string().nullable().optional(),
    inspiredBySlug: z.string().nullable().optional(),
  }),
  add_wanted_speaker: z.object({
    profile: z.string().optional(),
    contactId: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
    company: z.string().optional(),
    topics: z.array(z.string()).min(1),
    status: z.enum(speakerStatuses).optional(),
    note: z.string().optional(),
    availability: z.array(Window).optional(),
  }),
  list_wanted_speakers: z.object({
    topic: z.string().optional(),
    status: z.enum(speakerStatuses).optional(),
    availableOn: z.string().optional(),
  }),
  update_wanted_speaker: z.object({
    id: z.string(),
    status: z.enum(speakerStatuses).optional(),
    note: z.string().nullable().optional(),
    addTopics: z.array(z.string()).optional(),
    removeTopics: z.array(z.string()).optional(),
    addAvailability: z.array(Window).optional(),
    removeAvailability: z.array(z.string()).optional(),
  }),
  add_host_prospect: z.object({
    sponsor: z.string().optional(),
    company: z.string().optional(),
    contactId: z.string().optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().optional(),
    contactUrl: z.string().optional(),
    status: z.enum(hostStatuses).optional(),
    note: z.string().optional(),
  }),
  list_host_prospects: z.object({ status: z.enum(hostStatuses).optional() }),
  update_host_prospect: z.object({
    id: z.string(),
    status: z.enum(hostStatuses).optional(),
    note: z.string().nullable().optional(),
  }),
  add_planning_note: z.object({
    profile: z.string().optional(),
    sponsor: z.string().optional(),
    contactId: z.string().optional(),
    body: z.string(),
    author: z.string().optional(),
  }),
  search_planning: z.object({ query: z.string() }),
  audit_planning: z.object({}),
  draft_status: z.object({ slug: z.string() }),
  add_draft_note: z.object({
    slug: z.string(),
    kind: z.enum(["note", "decision", "question"]),
    text: z.string(),
    dryRun: z.boolean().optional(),
  }),
  resolve_draft_note: z.object({
    id: z.string(),
    dryRun: z.boolean().optional(),
  }),
} as const;

export type PlanTool = keyof typeof planSchemas;

export const planTools = Object.keys(planSchemas) as ReadonlyArray<PlanTool>;

export const isPlanTool = (name: string): name is PlanTool =>
  Object.hasOwn(planSchemas, name);

/**
 * `--name=value` when there is a value. One argument, so a value that
 * starts with a dash ("-x", "--two") is still the value, not another flag.
 */
const flag = (name: string, value: string | undefined): string[] =>
  value === undefined ? [] : [`--${name}=${value}`];

/** `--name=value` per value. */
const flags = (name: string, values: ReadonlyArray<string> | undefined) =>
  (values ?? []).map((value) => `--${name}=${value}`);

/** A value to set (`--name`), clear (`--clear-name`), or leave. */
const setOrClear = (name: string, value: string | null | undefined) =>
  value === null ? [`--clear-${name}`] : flag(name, value);

const windows = (
  name: string,
  values: ReadonlyArray<z.infer<typeof Window>> | undefined,
) =>
  flags(
    name,
    (values ?? []).map((window) => JSON.stringify(window)),
  );

const builders: { readonly [T in PlanTool]: (input: unknown) => string[] } = {
  add_idea: (input) => {
    const a = planSchemas.add_idea.parse(input);
    return [
      "idea",
      "add",
      ...flag("title", a.title),
      ...flag("pitch", a.pitch),
      ...flag("program", a.program),
      ...flag("topic", a.topic),
      ...flag("status", a.status),
      ...flag("event", a.eventSlug),
      ...flag("inspired-by", a.inspiredBySlug),
    ];
  },
  list_ideas: (input) => {
    const a = planSchemas.list_ideas.parse(input);
    return ["idea", "list", ...flag("status", a.status)];
  },
  update_idea: (input) => {
    const a = planSchemas.update_idea.parse(input);
    return [
      "idea",
      "update",
      ...flag("title", a.title),
      ...flag("pitch", a.pitch),
      ...flag("program", a.program),
      ...setOrClear("topic", a.topic),
      ...flag("status", a.status),
      ...setOrClear("event", a.eventSlug),
      ...setOrClear("inspired-by", a.inspiredBySlug),
      "--",
      a.id,
    ];
  },
  add_wanted_speaker: (input) => {
    const a = planSchemas.add_wanted_speaker.parse(input);
    return [
      "speaker",
      "add",
      ...flag("profile", a.profile),
      ...flag("contact", a.contactId),
      ...flag("name", a.name),
      ...flag("email", a.email),
      ...flag("url", a.url),
      ...flag("company", a.company),
      ...flags("topic", a.topics),
      ...flag("status", a.status),
      ...flag("note", a.note),
      ...windows("window", a.availability),
    ];
  },
  list_wanted_speakers: (input) => {
    const a = planSchemas.list_wanted_speakers.parse(input);
    return [
      "speaker",
      "list",
      ...flag("topic", a.topic),
      ...flag("status", a.status),
      ...flag("available-on", a.availableOn),
    ];
  },
  update_wanted_speaker: (input) => {
    const a = planSchemas.update_wanted_speaker.parse(input);
    return [
      "speaker",
      "update",
      ...flag("status", a.status),
      ...setOrClear("note", a.note),
      ...flags("add-topic", a.addTopics),
      ...flags("remove-topic", a.removeTopics),
      ...windows("add-window", a.addAvailability),
      ...flags("remove-window", a.removeAvailability),
      "--",
      a.id,
    ];
  },
  add_host_prospect: (input) => {
    const a = planSchemas.add_host_prospect.parse(input);
    return [
      "host",
      "add",
      ...flag("sponsor", a.sponsor),
      ...flag("company", a.company),
      ...flag("contact", a.contactId),
      ...flag("contact-name", a.contactName),
      ...flag("contact-email", a.contactEmail),
      ...flag("contact-url", a.contactUrl),
      ...flag("status", a.status),
      ...flag("note", a.note),
    ];
  },
  list_host_prospects: (input) => {
    const a = planSchemas.list_host_prospects.parse(input);
    return ["host", "list", ...flag("status", a.status)];
  },
  update_host_prospect: (input) => {
    const a = planSchemas.update_host_prospect.parse(input);
    return [
      "host",
      "update",
      ...flag("status", a.status),
      ...setOrClear("note", a.note),
      "--",
      a.id,
    ];
  },
  add_planning_note: (input) => {
    const a = planSchemas.add_planning_note.parse(input);
    return [
      "note",
      "add",
      ...flag("profile", a.profile),
      ...flag("sponsor", a.sponsor),
      ...flag("contact", a.contactId),
      ...flag("body", a.body),
      ...flag("author", a.author),
    ];
  },
  search_planning: (input) => {
    const a = planSchemas.search_planning.parse(input);
    return ["search", "--", a.query];
  },
  audit_planning: (input) => {
    planSchemas.audit_planning.parse(input);
    return ["audit"];
  },
  draft_status: (input) => {
    const a = planSchemas.draft_status.parse(input);
    return ["status", "--", a.slug];
  },
  add_draft_note: (input) => {
    const a = planSchemas.add_draft_note.parse(input);
    return [
      "note",
      ...flag("kind", a.kind),
      ...flag("text", a.text),
      ...(a.dryRun === true ? ["--dry-run"] : []),
      "--",
      a.slug,
    ];
  },
  resolve_draft_note: (input) => {
    const a = planSchemas.resolve_draft_note.parse(input);
    return [
      "note",
      "resolve",
      ...(a.dryRun === true ? ["--dry-run"] : []),
      "--",
      a.id,
    ];
  },
};

/**
 * The `bun run plan` arguments for `tool` with `input`, which it checks
 * first. Positionals follow "--", so text that starts with a dash stays
 * text.
 */
export const planArguments = (tool: PlanTool, input: unknown): string[] =>
  builders[tool](input);

/** Puts --json before the positionals, where the CLI reads flags. */
const withJson = (args: ReadonlyArray<string>): string[] => {
  const end = args.indexOf("--");
  return end === -1
    ? [...args, "--json"]
    : [...args.slice(0, end), "--json", ...args.slice(end)];
};

/**
 * Runs `tool`, returning core's JSON. A refusal (a name two profiles
 * share, a topic that isn't one) fails with core's reason.
 */
export async function planTool(
  tool: PlanTool,
  input: unknown,
): Promise<unknown> {
  const args = withJson(planArguments(tool, input));
  try {
    const { stdout } = await run("bun", ["run", "--silent", "plan", ...args], {
      cwd: core,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
      // A stalled database fails the tool call instead of hanging it.
      timeout: 60_000,
    });
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
const nullableString = (description: string) => ({
  type: ["string", "null"],
  description,
});
const strings = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});
const oneOf = (values: ReadonlyArray<string>, description: string) => ({
  type: "string",
  enum: [...values],
  description,
});
const windowList = (description: string) => ({
  type: "array",
  items: {
    type: "object",
    properties: {
      kind: oneOf(
        ["available", "unavailable"],
        "Free, or not (available by default)",
      ),
      startsOn: string("First day, YYYY-MM-DD; open if left out"),
      endsOn: string("Last day, YYYY-MM-DD; open if left out"),
      note: string('Their words, e.g. "free after Dec"'),
    },
  },
  description,
});

const privateNote =
  " Planning is private: never put what this returns on a page, in a post or in a file in the repository.";

const actorNote =
  " It writes as ALLTHINGS_ACTOR from this server's environment (like erik/claude-work: a label, not proof) and refuses without it, and adds a line to the draft's log in the same transaction.";

/** The tools as the MCP server lists them. */
export const planToolDefinitions: ReadonlyArray<{
  name: PlanTool;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}> = [
  {
    name: "add_idea",
    description: `Add an idea for an evening (planning). An idea links to the draft evening it becomes (eventSlug) and to a past evening it builds on (inspiredBySlug).${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        title: string("What it's called"),
        pitch: string("What the evening is, in a few sentences"),
        program: oneOf(programs, "What kind of evening it is"),
        topic: string('all things/<topic>, lowercase, e.g. "react native"'),
        status: oneOf(ideaStatuses, "Where it stands (idea by default)"),
        eventSlug: string("The draft evening it became, by slug"),
        inspiredBySlug: string("A past evening it builds on, by slug"),
      },
      required: ["title", "pitch", "program"],
    },
  },
  {
    name: "list_ideas",
    description: `List ideas for evenings, oldest first.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: { status: oneOf(ideaStatuses, "Only these") },
      required: [],
    },
  },
  {
    name: "update_idea",
    description: `Change an idea; null clears topic, eventSlug or inspiredBySlug. A scheduled idea must name its event.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        id: string("The idea's id"),
        title: string("A new title"),
        pitch: string("A new pitch"),
        program: oneOf(programs, "What kind of evening it is"),
        topic: nullableString("A new topic, or null to remove it"),
        status: oneOf(ideaStatuses, "Where it stands"),
        eventSlug: nullableString("The draft evening it became, or null"),
        inspiredBySlug: nullableString("A past evening it builds on, or null"),
      },
      required: ["id"],
    },
  },
  {
    name: "add_wanted_speaker",
    description: `Add a speaker we'd like on stage: a profile (by id or exact name), a stored contact (contactId), or someone new (name, with email, url and company). Topics are written as event topics are; availability windows keep their dates and words.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        profile: string("Their profile, by id or exact name"),
        contactId: string("A stored contact, by id"),
        name: string("Someone new: their name"),
        email: string("Someone new: their email"),
        url: string("Someone new: a link to them (https)"),
        company: string("Someone new: the hosting company they work at"),
        topics: strings("What they could speak about (at least one)"),
        status: oneOf(
          speakerStatuses,
          "Where we are with them (wanted by default)",
        ),
        note: string("Why them, or what's been said"),
        availability: windowList("When they're free, or not"),
      },
      required: ["topics"],
    },
  },
  {
    name: "list_wanted_speakers",
    description: `List wanted speakers by name, with their topics, availability and the notes on them.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        topic: string("Only those who could speak about this"),
        status: oneOf(speakerStatuses, "Only these"),
        availableOn: string("Only those free on this day, YYYY-MM-DD"),
      },
      required: [],
    },
  },
  {
    name: "update_wanted_speaker",
    description: `Change a wanted speaker: status, note (null clears it), topics and availability windows.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        id: string("The wanted speaker's id"),
        status: oneOf(speakerStatuses, "Where we are with them"),
        note: nullableString("A new note, or null to remove it"),
        addTopics: strings("Topics to add"),
        removeTopics: strings("Topics to remove"),
        addAvailability: windowList("Windows to add"),
        removeAvailability: strings("Windows to remove, by id"),
      },
      required: ["id"],
    },
  },
  {
    name: "add_host_prospect",
    description: `Add a company we'd like to host an evening: one we know (sponsor, by id or exact name) or a new one (company), with who to talk to (contactId, or contactName with contactEmail and contactUrl).${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        sponsor: string("A hosting company we know, by id or exact name"),
        company: string("A company we don't know yet, by name"),
        contactId: string("Who to talk to: a stored contact, by id"),
        contactName: string("Who to talk to, someone new: their name"),
        contactEmail: string("Someone new: their email"),
        contactUrl: string("Someone new: a link to them (https)"),
        status: oneOf(
          hostStatuses,
          "Where we are with them (prospect by default)",
        ),
        note: string("Why them, or what's been said"),
      },
      required: [],
    },
  },
  {
    name: "list_host_prospects",
    description: `List host prospects by name, with when each last hosted, how often, and the notes on them.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: { status: oneOf(hostStatuses, "Only these") },
      required: [],
    },
  },
  {
    name: "update_host_prospect",
    description: `Change a host prospect's status or note (null clears it).${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        id: string("The host prospect's id"),
        status: oneOf(hostStatuses, "Where we are with them"),
        note: nullableString("A new note, or null to remove it"),
      },
      required: ["id"],
    },
  },
  {
    name: "add_planning_note",
    description: `Add a relationship note on a profile, a hosting company (sponsor) or a contact.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        profile: string("About a profile, by id or exact name"),
        sponsor: string("About a hosting company, by id or exact name"),
        contactId: string("About a contact, by id"),
        body: string("The note"),
        author: string("Who wrote it"),
      },
      required: ["body"],
    },
  },
  {
    name: "search_planning",
    description: `Search ideas, wanted speakers, host prospects, contacts and notes for text, in any case.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: { query: string("Text to find") },
      required: ["query"],
    },
  },
  {
    name: "audit_planning",
    description:
      "Check that the site's roles (site_reader, site_sync) and PUBLIC can't reach planning; fails if one can, or if the database has no planning schema. Read-only.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "draft_status",
    description: `A draft evening in one read: its facts (Luma visibility and time, venue, program, whether its cover is current or stale), readiness's blockers and advice, its lineup and talks with whether each person has said yes, the companies we'd like to host, its collaboration (rounds, invitations and submissions, as a role that may read them), its open questions, decisions and notes, and the last 20 lines of its log. Read-only.${privateNote}`,
    inputSchema: {
      type: "object",
      properties: { slug: string("The draft evening, by slug") },
      required: ["slug"],
    },
  },
  {
    name: "add_draft_note",
    description: `Add a note, a decision or a question to a draft evening. Each is written once; a question stays open until resolved.${actorNote}${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        slug: string("The draft evening, by slug"),
        kind: oneOf(["note", "decision", "question"], "What it is"),
        text: string("What it says (up to 2000 characters)"),
        dryRun: {
          type: "boolean",
          description: "Write it in a transaction that is rolled back",
        },
      },
      required: ["slug", "kind", "text"],
    },
  },
  {
    name: "resolve_draft_note",
    description: `Resolve a draft evening's open question, by its id; a note or a decision is never changed.${actorNote}${privateNote}`,
    inputSchema: {
      type: "object",
      properties: {
        id: string("The question's id"),
        dryRun: {
          type: "boolean",
          description: "Resolve it in a transaction that is rolled back",
        },
      },
      required: ["id"],
    },
  },
];
