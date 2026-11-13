import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import {
  checkedCode,
  createAuxClient,
  parseAuxStatus,
  parseTracks,
  queuePositionOf,
  readAuxCode,
  saveAuxCode,
  type AuxClient,
  type AuxResult,
} from "./aux.ts";
import { createClient, toolNames, type Client, type Fetch } from "./client.ts";
import { longestOpenFloor, talkToCoach } from "./coach.ts";
import type { ProposalFields } from "./schemas.ts";
import {
  auxCodeVariable,
  auxEndpointFrom,
  auxEndpointVariable,
  commandName,
  defaultAuxEndpoint,
  endpointFrom,
  endpointVariable,
  legacyCommandName,
  siteOrigin,
} from "./config.ts";
import { CliError, ExitCode } from "./errors.ts";
import { suggest } from "./suggest.ts";
import { goals as knownGoals, type EventSummary } from "./schemas.ts";
import {
  formatAuxStatus,
  formatCoaching,
  formatCommunity,
  formatGuide,
  formatEvent,
  formatEventSummary,
  formatEventList,
  formatSpeakers,
  formatTracks,
} from "./format.ts";

export type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** True when stdout is a terminal; color and hints are only for people. */
  isTTY: boolean;
  env: Record<string, string | undefined>;
  openUrl: (url: string) => Promise<void>;
  client?: Client;
  /** The fetch the aux hub's client uses; tests pass a fake. */
  fetch?: Fetch;
  /** True when started by its old name, `atw`, which still works for now. */
  legacy?: boolean;
  /** Reads a file `coach` is given; tests pass a fake. */
  readFile?: (path: string) => Promise<string>;
  /**
   * Asks a person a question and reads their line: only when stdin and
   * stdout are a terminal, else absent. Null when they end the input.
   */
  prompt?: (question: string) => Promise<string | null>;
};

const tagline = `${commandName} · evenings for people who build software, from your terminal and your agents`;

const help = `${tagline}

Usage
  ${commandName}
  ${commandName} events [--past | --all] [--limit <n>] [--json]
  ${commandName} event <slug | next | latest> [--json]
  ${commandName} speakers [search] [--limit <n>] [--json]
  ${commandName} rsvp <slug | next> [--print]
  ${commandName} open <slug | next | latest> [--print]
  ${commandName} guide [--json]
  ${commandName} about [--json]
  ${commandName} coach <files...> [--slot <minutes>] [--talk] [--goal <goal>] [--json]
  ${commandName} propose [--title "…" --abstract "…" --name "…" --email "…" …] [--json]
  ${commandName} mcp [--json]
  ${commandName} aux <command> [--json]

Examples
  ${commandName}                             The next evening, and what to run from there
  ${commandName} events                      What's coming up
  ${commandName} events --past --limit 5     The five most recent evenings
  ${commandName} event next --json           The next evening in full, for scripts and agents
  ${commandName} event latest                The last evening: its talks and video
  ${commandName} speakers react              Who has been on stage about react
  ${commandName} rsvp next                   Open the next evening's page to say you're in
  ${commandName} open latest                 Open the last evening's page on allthings.dev
  ${commandName} guide                       Conferences worth the trip, starred
  ${commandName} coach slides.md talk.vtt    Coach your talk for our stage before you give it
  ${commandName} propose                     Propose a talk: it asks for each part
  ${commandName} mcp                         Add allthings to Claude Code, Codex, Grok Build, VS Code or Cursor
  ${commandName} aux --help                 Set the room's lights at an evening that passes the aux

Options
  --json        Print the public JSON contract instead of text
  -h, --help    Show this help
  -v, --version Show the version

Exit codes: 0 ok, 1 service error, 2 usage error, 3 event not found.
`;

const auxHelp = `${commandName} aux · the room's lights, at an evening that passes the aux

Usage
  ${commandName} aux login <code>
  ${commandName} aux status [--json]
  ${commandName} aux scenes [--json]
  ${commandName} aux scene <name> [--json]
  ${commandName} aux color <name> [--zone <zone>] [--json]
  ${commandName} aux request [--json]
  ${commandName} aux pass [--json]
  ${commandName} aux tracks [--json]
  ${commandName} aux queue <slug> [--json]
  ${commandName} aux skip [--json]

Examples
  ${commandName} aux login <code>        Save the code from your card
  ${commandName} aux status              Who has the aux, your place in line, your cooldown
  ${commandName} aux scene ocean         Set the room to one of tonight's scenes
  ${commandName} aux color mint          Set a color, on one --zone or everywhere
  ${commandName} aux request             Get in line for the aux; pass hands it on
  ${commandName} aux queue <slug>        Queue one of tonight's tracks, when music is on

Options
  --zone <zone> Set the color on one zone only
  --json        Print the hub's JSON instead of text
  -h, --help    Show this help

Exit codes: 0 ok, 1 the hub refused or couldn't be reached, 2 usage error (an unknown scene or color, or no code).
Set ${auxCodeVariable} to use a code without saving it, and ${auxEndpointVariable} to use another hub (default ${defaultAuxEndpoint}).
`;

const coachHelp = `${commandName} coach · coaching for your talk, before you're on our stage

Usage
  ${commandName} coach <files...> [--slot <minutes>] [--talk] [--goal <goal>]... [--title <title>] [--abstract <text>] [--json]

Files
  .md                  An outline, or slides split by lines of ---
  .txt, .vtt, .srt     A rehearsal's transcript; with timestamps (.vtt, .srt) it also checks your pace

Examples
  ${commandName} coach slides.md rehearsal.vtt            A 3-minute open-floor slot
  ${commandName} coach outline.md --slot 20 --goal teach-a-technique
  ${commandName} coach rehearsal.txt --goal first-talk --json

Options
  --slot <minutes>  The slot's length: 3 unless given, 20 with --talk; over ${longestOpenFloor} is a talk
  --talk            A talk in an evening's lineup, not an open floor
  --goal <goal>     What you want from it, as often as you like: ${knownGoals.join(", ")}
  --title <title>   The talk's title; otherwise the outline's first heading
  --abstract <text> The talk's abstract, as people will read it
  --json            Print coach_talk's JSON instead of text
  -h, --help        Show this help

The files go to coach_talk on ${siteOrigin}/mcp, which keeps none of what it is sent.
Exit codes: 0 coached, 1 service error, 2 usage error (a file it can't read, an unknown goal).
`;

const proposeHelp = `${commandName} propose · propose a talk for an evening

An open door and a high bar: anyone may propose, and we pick the talks people
will still talk about on the way home. Something you built, broke or worked out
the hard way; open source above all; never a product pitch. Erik and Andre read
every proposal and reply by email.

Usage
  ${commandName} propose
  ${commandName} propose --title "…" --abstract "…" --name "…" --email "…"
    [--format talk|lightning|demo] [--about "…"] [--link https://…]… [--notes "…"]
    [--yes] [--json]

In a terminal, it asks for each part you leave out, then shows the proposal and
asks before sending it. Elsewhere it takes them all as options, and sends.

Options
  --title       The talk's title, on one line
  --abstract    What it's about, and what people will leave knowing (40+ characters)
  --format      talk (about 20 minutes, the default), lightning (about 5) or demo (about 10)
  --name        Your name, as you'd like it on the evening
  --email       Where we reply; only the organizers see it
  --about       What you build, and where
  --link        An https link: your site, GitHub, the project; up to four
  --notes       Dates that work, a co-speaker, anything else
  --yes         Send it without asking first
  --json        Print the server's answer as JSON

Exit codes: 0 sent, 1 the server couldn't take it, 2 something in it to fix.
Nothing you send shows on allthings.dev unless you give the talk.
`;

function usage(message: string): never {
  throw new CliError(
    `${message}\nRun "${commandName} --help" for usage.`,
    ExitCode.UsageError,
  );
}

function parseLimit(value: string | undefined, fallback: number, max: number) {
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    usage(`--limit must be a whole number from 1 to ${max}.`);
  }
  return limit;
}

/**
 * Where new evenings are announced, for when nothing is on the calendar. The
 * link comes from the community's own record; without it, the sentence still
 * says what to run next.
 */
async function whereNextIsAnnounced(client: Client): Promise<string> {
  try {
    const { links } = await client.getCommunity();
    return `New evenings land on ${links.events} first.`;
  } catch {
    return `Run "${commandName} about" for where new evenings land first.`;
  }
}

const nothingScheduled = "Nothing is on the calendar yet.";

/**
 * The slug an event argument names. Besides a slug, `next` is the soonest
 * upcoming evening and `latest` the most recent one that happened, so the
 * examples run as typed. Slugs start with a date, so neither is ever a slug.
 */
async function resolveSlug(client: Client, argument: string): Promise<string> {
  if (argument !== "next" && argument !== "latest") return argument;
  const [found] = await client.listEvents(
    argument === "next" ? "upcoming" : "past",
    1,
  );
  if (found !== undefined) return found.slug;
  throw new CliError(
    argument === "next"
      ? `${nothingScheduled} ${await whereNextIsAnnounced(client)} "${commandName} event latest" shows the last evening.`
      : "No evening has happened yet.",
    ExitCode.NotFound,
  );
}

/** A word for the shell, as typed: quoted only when it has to be. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * `allthings mcp`: how to give an agent the server this CLI reads, with a
 * line to paste for each agent that takes one. It reads nothing, so it works
 * offline, and it names whatever server the environment points the CLI at,
 * so a local Worker gets lines of its own.
 */
function mcpSetup(endpoint: string, json: boolean): string {
  const name = commandName;
  if (json) {
    const setup = {
      name,
      url: endpoint,
      transport: "streamable-http",
      tools: toolNames,
    };
    return `${JSON.stringify(setup, null, 2)}\n`;
  }
  const url = shellWord(endpoint);
  const vscode = JSON.stringify({ name, type: "http", url: endpoint });
  const cursor = JSON.stringify({ mcpServers: { [name]: { url: endpoint } } });
  const agents: [string, string][] = [
    ["Claude Code", `claude mcp add --transport http ${name} ${url}`],
    ["Codex", `codex mcp add ${name} --url ${url}`],
    ["Grok Build", `grok mcp add ${name} ${url}`],
    ["VS Code", `code --add-mcp ${shellWord(vscode)}`],
    ["Cursor", `in .cursor/mcp.json: ${cursor}`],
  ];
  const width = Math.max(...agents.map(([agent]) => agent.length)) + 2;
  const lines = agents
    .map(([agent, line]) => `  ${agent.padEnd(width)}${line}`)
    .join("\n");
  return `${commandName} mcp · the server your agent can read: ${endpoint}

Streamable HTTP, public, no sign-in. Its tools are the ones this CLI calls: ${toolNames.join(", ")}.

Add it
${lines}

An agent with a shell can run this CLI too: every command but rsvp and open takes --json.
Set ${endpointVariable} to point this CLI, and these lines, at another server.
`;
}

const proposalFormats = ["talk", "lightning", "demo"] as const;
type ProposalFormat = (typeof proposalFormats)[number];
const isProposalFormat = (value: string): value is ProposalFormat =>
  (proposalFormats as ReadonlyArray<string>).includes(value);

/** The options `propose` takes, as parsed. */
interface ProposeOptions {
  readonly title?: string | undefined;
  readonly abstract?: string | undefined;
  readonly format?: string | undefined;
  readonly name?: string | undefined;
  readonly email?: string | undefined;
  readonly about?: string | undefined;
  readonly link?: ReadonlyArray<string> | undefined;
  readonly notes?: string | undefined;
  readonly yes: boolean;
}

/** The options only `propose` takes; a title and an abstract `coach` takes too. */
const proposeOnly = [
  "format",
  "name",
  "email",
  "about",
  "link",
  "notes",
  "yes",
] as const;

const required = ["title", "abstract", "name", "email"] as const;

/** Text given, or undefined when it is blank. */
const given = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? undefined : value.trim();

/**
 * The proposal `allthings propose` sends: its options, and in a terminal
 * an answer to a question for each part left out (every part, when none
 * was given), then the proposal shown whole and a yes before it goes,
 * unless --yes. Elsewhere, every required part must be an option. The
 * server checks the rest and says what to fix.
 */
async function proposal(
  options: ProposeOptions,
  io: Io,
): Promise<ProposalFields | null> {
  if (options.format !== undefined && !isProposalFormat(options.format)) {
    usage(`--format is talk, lightning or demo.`);
  }
  const prompt = io.isTTY ? io.prompt : undefined;
  const missing = required.filter((part) => given(options[part]) === undefined);
  if (missing.length > 0 && prompt === undefined) {
    usage(
      `"propose" needs ${missing.map((part) => `--${part}`).join(", ")}. Run it in a terminal to be asked for each.`,
    );
  }
  const none =
    options.title === undefined &&
    options.abstract === undefined &&
    proposeOnly.every((option) =>
      option === "yes"
        ? !options.yes
        : option === "link"
          ? (options.link ?? []).length === 0
          : options[option] === undefined,
    );
  /** Asks until it gets an answer, or a blank one when `optional`; null when the input ends. */
  const ask = async (question: string, optional: boolean) => {
    for (;;) {
      const answer = await prompt!(question);
      if (answer === null) return null;
      if (answer.trim() !== "" || optional) return answer.trim();
    }
  };
  const parts: Record<string, string | undefined> = {
    title: given(options.title),
    abstract: given(options.abstract),
    name: given(options.name),
    email: given(options.email),
    format: options.format,
    about: given(options.about),
    notes: given(options.notes),
  };
  let links = (options.link ?? []).flatMap((link) => given(link) ?? []);
  if (prompt !== undefined) {
    const questions: ReadonlyArray<
      readonly [string, string, boolean, boolean]
    > = [
      // [part, question, optional, asked only when no option was given]
      ["title", "Title: ", false, false],
      [
        "format",
        "Format, talk (about 20 min), lightning (5) or demo (10) [talk]: ",
        true,
        true,
      ],
      [
        "abstract",
        "Abstract, what it's about and what people will leave knowing: ",
        false,
        false,
      ],
      ["name", "Your name: ", false, false],
      [
        "email",
        "Your email, where we reply (only the organizers see it): ",
        false,
        false,
      ],
      ["about", "About you, what you build and where (optional): ", true, true],
      [
        "links",
        "Links, https and separated by spaces (optional): ",
        true,
        true,
      ],
      [
        "notes",
        "Notes for us: dates that work, anything else (optional): ",
        true,
        true,
      ],
    ];
    for (const [part, question, optional, onlyWhenNone] of questions) {
      if (onlyWhenNone ? !none : parts[part] !== undefined) continue;
      if (part === "format") {
        for (;;) {
          const answer = await ask(question, true);
          if (answer === null) return null;
          if (answer === "" || isProposalFormat(answer)) {
            parts["format"] = answer === "" ? undefined : answer;
            break;
          }
          io.stderr("It's talk, lightning or demo.\n");
        }
        continue;
      }
      const answer = await ask(question, optional);
      if (answer === null) return null;
      if (part === "links") links = answer.split(/\s+/).filter(Boolean);
      else parts[part] = answer === "" ? undefined : answer;
    }
  }
  const fields: ProposalFields = {
    title: parts["title"]!,
    abstract: parts["abstract"]!,
    name: parts["name"]!,
    email: parts["email"]!,
    ...(parts["format"] === undefined
      ? {}
      : { format: parts["format"] as ProposalFormat }),
    ...(parts["about"] === undefined ? {} : { about: parts["about"] }),
    ...(links.length === 0 ? {} : { links }),
    ...(parts["notes"] === undefined ? {} : { notes: parts["notes"] }),
  };
  if (prompt !== undefined && !options.yes) {
    io.stdout(`\n${formatProposal(fields)}\n`);
    const answer = await prompt("Send it? [y/N] ");
    if (answer === null || !/^y(es)?$/i.test(answer.trim())) return null;
  }
  return fields;
}

/** A proposal as its sender reads it back before it goes. */
function formatProposal(fields: ProposalFields): string {
  return [
    `${fields.title} (${fields.format ?? "talk"})`,
    fields.abstract,
    `${fields.name} <${fields.email}>`,
    ...(fields.about === undefined ? [] : [`About you: ${fields.about}`]),
    ...(fields.links ?? []).map((link) => `Link: ${link}`),
    ...(fields.notes === undefined ? [] : [`Notes: ${fields.notes}`]),
  ]
    .map((line) => `  ${line}`)
    .join("\n")
    .concat("\n");
}

/** A command to try and what it does, lined up for reading. */
function tryLines(commands: [string, string][]): string {
  const width = Math.max(...commands.map(([command]) => command.length)) + 4;
  return commands
    .map(
      ([command, what]) =>
        `  ${`${commandName} ${command}`.padEnd(width + commandName.length + 1)}${what}`,
    )
    .join("\n");
}

/**
 * `allthings` on its own: the next evening and the commands that go from
 * there, or the last evening when nothing is on the calendar. A person or an
 * agent trying it for the first time lands on something real to act on,
 * every line of it runnable as typed.
 */
async function home(
  client: Client,
  json: boolean,
  color: boolean,
): Promise<string> {
  const [[next = null], [latest = null]] = await Promise.all([
    client.listEvents("upcoming", 1),
    client.listEvents("past", 1),
  ]);
  if (json) return `${JSON.stringify({ next, latest }, null, 2)}\n`;
  const event = (label: string, summary: EventSummary) =>
    `${label}\n${formatEventSummary(summary, color)}`;
  const everything: [string, string][] = [
    ["speakers react", "Who has been on stage about react"],
    ["about", "Where everyone is between evenings"],
    ["mcp", "Add allthings to your agent"],
    ["--help", "Every command; most take --json for scripts and agents"],
  ];
  const sections =
    next !== null
      ? [
          event("Next up", next),
          tryLines([
            ["event next", "The talks and who's on stage"],
            ...(next.rsvpUrl === null
              ? []
              : ([["rsvp next", "Say you're in"]] as [string, string][])),
            ["events", "Everything coming up"],
            ...everything,
          ]),
        ]
      : [
          `${nothingScheduled} ${await whereNextIsAnnounced(client)}`,
          ...(latest === null ? [] : [event("Last time", latest)]),
          tryLines([
            ...(latest === null
              ? []
              : ([["event latest", "Its talks, speakers and video"]] as [
                  string,
                  string,
                ][])),
            ["events --past", "Every evening so far"],
            ...everything,
          ]),
        ];
  return `${tagline}\n\n${sections.join("\n\n")}\n`;
}

function auxUsage(message: string): never {
  throw new CliError(
    `${message}\nRun "${commandName} aux --help" for usage.`,
    ExitCode.UsageError,
  );
}

/** The one argument a subcommand takes, or a usage error. */
function oneArgument(args: string[], what: string, name: string): string {
  const [value, ...extra] = args;
  if (value === undefined || extra.length > 0) {
    auxUsage(`"aux ${name}" takes ${what}.`);
  }
  return value;
}

function noArguments(args: string[], name: string) {
  if (args.length > 0) auxUsage(`"aux ${name}" takes no arguments.`);
}

/** What an aux command prints: text for people, the hub's JSON for scripts. */
type AuxOutput = { text: string; data: unknown };

/**
 * Checks an aux command's arguments, before any code is needed, and returns
 * what it does with the hub.
 */
function auxCommand(
  name: string,
  args: string[],
  zone: string | undefined,
  color: boolean,
): (aux: AuxClient) => Promise<AuxOutput> {
  const done = (text: string) => (result: AuxResult) => ({
    text: `${text}\n`,
    data: result.data,
  });
  switch (name) {
    case "status":
      noArguments(args, name);
      return async (aux) => {
        const result = await aux.status();
        const status = parseAuxStatus(result.data);
        // A hub whose status has another shape still says something useful.
        return {
          text:
            status === null
              ? `${result.text}\n`
              : formatAuxStatus(status, color),
          data: result.data,
        };
      };
    case "scenes":
      noArguments(args, name);
      return async (aux) => {
        const status = parseAuxStatus((await aux.status()).data);
        if (status === null) {
          throw new CliError(
            "The aux_status response does not match the contract this CLI expects. Updating the CLI may fix this.",
            ExitCode.ServiceError,
          );
        }
        return {
          text: status.scenes.map((scene) => `${scene}\n`).join(""),
          data: { scenes: status.scenes },
        };
      };
    case "scene": {
      const scene = oneArgument(args, "one scene name", name);
      return async (aux) =>
        done(`The room is on "${scene}".`)(await aux.setScene(scene));
    }
    case "color": {
      const value = oneArgument(args, "one color name", name);
      return async (aux) =>
        done(
          zone === undefined
            ? `The room is "${value}".`
            : `${zone} is "${value}".`,
        )(await aux.setColor(value, zone));
    }
    case "request":
      noArguments(args, name);
      return async (aux) => {
        const result = await aux.requestAux();
        const position = queuePositionOf(result.data);
        return done(
          position === null
            ? "You're in line for the aux."
            : `You're #${position} in line for the aux.`,
        )(result);
      };
    case "pass":
      noArguments(args, name);
      return async (aux) => done("You passed the aux on.")(await aux.passAux());
    case "tracks":
      noArguments(args, name);
      return async (aux) => {
        const result = await aux.listTracks();
        const tracks = parseTracks(result.data);
        return {
          text:
            tracks === null ? `${result.text}\n` : formatTracks(tracks, color),
          data: result.data,
        };
      };
    case "queue": {
      const slug = oneArgument(args, "one track slug", name);
      return async (aux) => done(`Queued ${slug}.`)(await aux.queueTrack(slug));
    }
    case "skip":
      noArguments(args, name);
      return async (aux) => done("Skipped.")(await aux.skipTrack());
    default: {
      // Never repeated back: a guest may have typed their code here. The
      // suggestion is one of the known commands, never their input.
      const nearest = suggest(name, auxCommands);
      return auxUsage(
        nearest === undefined
          ? `"aux" has no such command.`
          : `"aux" has no such command. Did you mean "${commandName} aux ${nearest}"?`,
      );
    }
  }
}

/**
 * Runs `allthings aux …`. The guest's code never reaches stdout or stderr:
 * every line is printed with it masked, whatever the hub answered.
 */
async function runAux(
  args: string[],
  values: { json: boolean; help: boolean; zone?: string | undefined },
  io: Io,
): Promise<ExitCode> {
  const [name, ...rest] = args;
  if (values.help || name === undefined || name === "help") {
    io.stdout(auxHelp);
    return ExitCode.Ok;
  }
  let code: string | null = null;
  const mask = (text: string) =>
    code === null ? text : text.replaceAll(code, "[your code]");
  // In JSON, the code is masked inside string values, never in the
  // serialized text or the keys, so masking can't break the JSON or change
  // other values.
  const maskData = (value: unknown): unknown => {
    if (typeof value === "string") return mask(value);
    if (Array.isArray(value)) return value.map(maskData);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, maskData(entry)]),
      );
    }
    return value;
  };
  const print = (text: string, data: unknown) =>
    io.stdout(
      values.json ? `${JSON.stringify(maskData(data), null, 2)}\n` : mask(text),
    );
  try {
    if (values.zone !== undefined && name !== "color") {
      auxUsage('"--zone" works only with "aux color".');
    }
    if (name === "login") {
      code = checkedCode(
        oneArgument(rest, "the code from your card", name),
        "That",
      );
      const path = await saveAuxCode(io.env, code);
      const overridden =
        (io.env[auxCodeVariable] ?? "").trim() === ""
          ? ""
          : ` ${auxCodeVariable} is set, though, and wins over it.`;
      print(
        `Saved your code in ${path}, readable by you alone.${overridden}\nRun "${commandName} aux status" to check the hub knows it.\n`,
        { saved: true, path },
      );
      return ExitCode.Ok;
    }
    const command = auxCommand(
      name,
      rest,
      values.zone,
      io.isTTY && !io.env["NO_COLOR"] && !values.json,
    );
    code = await readAuxCode(io.env);
    if (code === null) {
      throw new CliError(
        `No aux code yet. Run "${commandName} aux login <code>" with the code from your card.`,
        ExitCode.UsageError,
      );
    }
    const output = await command(
      createAuxClient({
        endpoint: auxEndpointFrom(io.env),
        code,
        fetch: io.fetch,
      }),
    );
    print(output.text, output.data);
    return ExitCode.Ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(mask(`${commandName}: ${message}\n`));
    return error instanceof CliError ? error.exitCode : ExitCode.ServiceError;
  }
}

/** What the old name prints, on stderr so scripts reading stdout are unaffected. */
export const legacyNote = `${legacyCommandName} is now ${commandName}. The old name still works for now and goes away in a later release.\n`;

/** Every option, for parsing and for suggesting one when it is mistyped. */
const options = {
  json: { type: "boolean", default: false },
  past: { type: "boolean", default: false },
  all: { type: "boolean", default: false },
  limit: { type: "string" },
  print: { type: "boolean", default: false },
  zone: { type: "string" },
  slot: { type: "string" },
  talk: { type: "boolean", default: false },
  goal: { type: "string", multiple: true },
  title: { type: "string" },
  abstract: { type: "string" },
  format: { type: "string" },
  name: { type: "string" },
  email: { type: "string" },
  about: { type: "string" },
  link: { type: "string", multiple: true },
  notes: { type: "string" },
  yes: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
} as const;

/** The commands `run` knows, for suggesting one when it is mistyped. */
const commands = [
  "events",
  "event",
  "speakers",
  "rsvp",
  "open",
  "guide",
  "propose",
  "about",
  "coach",
  "mcp",
  "aux",
  "help",
] as const;

/** The aux commands, for suggesting one; never the guest's input. */
const auxCommands = [
  "login",
  "status",
  "scenes",
  "scene",
  "color",
  "request",
  "pass",
  "tracks",
  "queue",
  "skip",
] as const;

/**
 * What a parse error says, in the CLI's words: an unknown option names the
 * nearest real one, without node's advice about positionals.
 */
function parseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const unknown = /^Unknown option '(-{1,2}[^']+)'/.exec(message)?.[1];
  if (unknown === undefined) return message;
  const names = Object.keys(options).map((name) => `--${name}`);
  const nearest = suggest(unknown, names);
  return nearest === undefined
    ? `Unknown option "${unknown}".`
    : `Unknown option "${unknown}". Did you mean "${nearest}"?`;
}

export async function run(argv: string[], io: Io): Promise<ExitCode> {
  if (io.legacy === true) io.stderr(legacyNote);
  try {
    const parsed = (() => {
      try {
        return parseArgs({
          args: argv,
          allowPositionals: true,
          strict: true,
          options,
        });
      } catch (error) {
        return usage(parseError(error));
      }
    })();
    const { values, positionals } = parsed;
    const [command, ...rest] = positionals;

    if (values.version) {
      io.stdout(`${packageJson.version}\n`);
      return ExitCode.Ok;
    }
    // Before aux, which reads none of them: a proposal's options anywhere
    // else are a usage error, and nothing runs. Help still comes first.
    const helping = values.help || command === "help";
    if (
      !helping &&
      command !== "propose" &&
      proposeOnly.some((option) =>
        option === "yes"
          ? values.yes
          : option === "link"
            ? values.link !== undefined
            : values[option] !== undefined,
      )
    ) {
      usage(`--${proposeOnly.join(", --")} go with "propose".`);
    }
    // A title and an abstract are a talk's, for coach and propose alike.
    if (
      !helping &&
      command !== "coach" &&
      command !== "propose" &&
      (values.title !== undefined || values.abstract !== undefined)
    ) {
      usage(`--title and --abstract go with "coach" or "propose".`);
    }
    if (command === "aux") return await runAux(rest, values, io);
    if (command === "coach" && values.help) {
      io.stdout(coachHelp);
      return ExitCode.Ok;
    }
    if (command === "propose" && values.help) {
      io.stdout(proposeHelp);
      return ExitCode.Ok;
    }
    if (helping) {
      io.stdout(help);
      return ExitCode.Ok;
    }
    if (values.zone !== undefined)
      usage('"--zone" works only with "aux color".');
    if (
      command !== "coach" &&
      (values.slot !== undefined || values.talk || values.goal !== undefined)
    ) {
      usage(`--slot, --talk and --goal go with "coach".`);
    }

    const color = io.isTTY && !io.env["NO_COLOR"] && !values.json;
    const client =
      io.client ?? createClient({ endpoint: endpointFrom(io.env) });
    const print = (text: string, data: unknown) =>
      io.stdout(values.json ? `${JSON.stringify(data, null, 2)}\n` : text);
    /** Prints a link, and opens it too for a person at a terminal, unless --print. */
    const printAndOpen = async (url: string) => {
      io.stdout(`${url}\n`);
      if (!values.print && io.isTTY) await io.openUrl(url);
      return ExitCode.Ok;
    };

    switch (command) {
      case undefined: {
        if (values.past || values.all || values.limit !== undefined) {
          usage(`--past, --all and --limit go with "events".`);
        }
        io.stdout(await home(client, values.json, color));
        return ExitCode.Ok;
      }
      case "events": {
        if (rest.length > 0) usage(`"events" takes no arguments.`);
        if (values.past && values.all) usage("Use --past or --all, not both.");
        const when = values.all ? "all" : values.past ? "past" : "upcoming";
        const events = await client.listEvents(
          when,
          parseLimit(values.limit, 20, 100),
        );
        print(
          events.length === 0 && when === "upcoming" && !values.json
            ? `${nothingScheduled} ${await whereNextIsAnnounced(client)} "${commandName} events --past" shows the evenings so far.\n`
            : formatEventList(events, color),
          { events },
        );
        return ExitCode.Ok;
      }
      case "event": {
        const [slug, ...extra] = rest;
        if (slug === undefined || extra.length > 0)
          usage(`"event" takes one event slug, or next or latest.`);
        const event = await client.getEvent(await resolveSlug(client, slug));
        print(formatEvent(event, color), event);
        return ExitCode.Ok;
      }
      case "speakers": {
        if (rest.length > 1) usage(`"speakers" takes at most one search term.`);
        const speakers = await client.listSpeakers(
          rest[0],
          parseLimit(values.limit, 50, 200),
        );
        print(formatSpeakers(speakers, color), { speakers });
        return ExitCode.Ok;
      }
      case "rsvp": {
        const [slug, ...extra] = rest;
        if (slug === undefined || extra.length > 0)
          usage(`"rsvp" takes one event slug, or next.`);
        const event = await client.getEvent(await resolveSlug(client, slug));
        if (!event.rsvpUrl) {
          throw new CliError(
            `${event.name} has no RSVP page.`,
            ExitCode.NotFound,
          );
        }
        return await printAndOpen(event.rsvpUrl);
      }
      case "open": {
        const [slug, ...extra] = rest;
        if (slug === undefined || extra.length > 0)
          usage(`"open" takes one event slug, or next or latest.`);
        const event = await client.getEvent(await resolveSlug(client, slug));
        return await printAndOpen(event.url);
      }
      case "propose": {
        if (rest.length > 0) {
          usage(`"propose" takes its parts as options, like --title "…".`);
        }
        const fields = await proposal(values, io);
        if (fields === null) {
          io.stderr("Nothing was sent.\n");
          return ExitCode.UsageError;
        }
        const answer = await client.proposeTalk(fields);
        print(`${answer.message}\n`, answer);
        return ExitCode.Ok;
      }
      case "mcp": {
        if (rest.length > 0) usage(`"mcp" takes no arguments.`);
        io.stdout(mcpSetup(endpointFrom(io.env), values.json));
        return ExitCode.Ok;
      }
      case "guide": {
        if (rest.length > 0) usage(`"guide" takes no arguments.`);
        const guide = await client.getGuide();
        print(formatGuide(guide, color), guide);
        return ExitCode.Ok;
      }
      case "coach": {
        if (values.past || values.all || values.limit !== undefined) {
          usage(`--past, --all and --limit go with "events".`);
        }
        const read = io.readFile ?? ((path: string) => Bun.file(path).text());
        const files = await Promise.all(
          rest.map(async (path) => {
            try {
              return { path, text: await read(path) };
            } catch (error) {
              const reason =
                error instanceof Error && "code" in error
                  ? String(error.code)
                  : error instanceof Error
                    ? error.message
                    : String(error);
              return usage(`Can't read ${path} (${reason}).`);
            }
          }),
        );
        const talk = talkToCoach(files, {
          slot: values.slot,
          talk: values.talk,
          goals: values.goal ?? [],
          title: values.title,
          abstract: values.abstract,
        });
        const coaching = await client.coachTalk(talk);
        print(formatCoaching(coaching, color, `${siteOrigin}/coach`), coaching);
        return ExitCode.Ok;
      }
      case "about": {
        if (rest.length > 0) usage(`"about" takes no arguments.`);
        const community = await client.getCommunity();
        print(formatCommunity(community, color), community);
        return ExitCode.Ok;
      }
      default: {
        const nearest = suggest(command, commands);
        return usage(
          nearest === undefined
            ? `Unknown command "${command}".`
            : `Unknown command "${command}". Did you mean "${commandName} ${nearest}"?`,
        );
      }
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(`${commandName}: ${error.message}\n`);
      return error.exitCode;
    }
    io.stderr(
      `${commandName}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return ExitCode.ServiceError;
  }
}
