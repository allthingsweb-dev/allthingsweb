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
import { createClient, type Client, type Fetch } from "./client.ts";
import {
  auxCodeVariable,
  auxEndpointFrom,
  auxEndpointVariable,
  commandName,
  defaultAuxEndpoint,
  defaultEndpoint,
  endpointFrom,
  endpointVariable,
  legacyCommandName,
} from "./config.ts";
import { CliError, ExitCode } from "./errors.ts";
import {
  formatAuxStatus,
  formatCommunity,
  formatEvent,
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
};

const help = `${commandName} · evenings for people who build software, from your terminal and your agents

Usage
  ${commandName} events [--past | --all] [--limit <n>] [--json]
  ${commandName} event <slug> [--json]
  ${commandName} speakers [search] [--limit <n>] [--json]
  ${commandName} rsvp <slug> [--print]
  ${commandName} about [--json]
  ${commandName} aux <command> [--json]

Examples
  ${commandName} events                      What's coming up
  ${commandName} events --past --limit 5     The five most recent evenings
  ${commandName} event <slug> --json         One evening in full, for scripts and agents
  ${commandName} speakers react              Who has been on stage about react
  ${commandName} rsvp <slug>                 Open the evening's page to say you're in
  ${commandName} aux --help                  Set the room's lights at an evening that passes the aux

Options
  --json        Print the public JSON contract instead of text
  -h, --help    Show this help
  -v, --version Show the version

Exit codes: 0 ok, 1 service error, 2 usage error, 3 event not found.
Set ${endpointVariable} to use another server (default ${defaultEndpoint}).
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
    default:
      // Never repeated back: a guest may have typed their code here.
      return auxUsage(`"aux" has no such command.`);
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

export async function run(argv: string[], io: Io): Promise<ExitCode> {
  if (io.legacy === true) io.stderr(legacyNote);
  try {
    const parsed = (() => {
      try {
        return parseArgs({
          args: argv,
          allowPositionals: true,
          strict: true,
          options: {
            json: { type: "boolean", default: false },
            past: { type: "boolean", default: false },
            all: { type: "boolean", default: false },
            limit: { type: "string" },
            print: { type: "boolean", default: false },
            zone: { type: "string" },
            help: { type: "boolean", short: "h", default: false },
            version: { type: "boolean", short: "v", default: false },
          },
        });
      } catch (error) {
        return usage(error instanceof Error ? error.message : String(error));
      }
    })();
    const { values, positionals } = parsed;
    const [command, ...rest] = positionals;

    if (values.version) {
      io.stdout(`${packageJson.version}\n`);
      return ExitCode.Ok;
    }
    if (command === "aux") return await runAux(rest, values, io);
    if (values.help || command === undefined || command === "help") {
      io.stdout(help);
      return ExitCode.Ok;
    }
    if (values.zone !== undefined)
      usage('"--zone" works only with "aux color".');

    const color = io.isTTY && !io.env["NO_COLOR"] && !values.json;
    const client =
      io.client ?? createClient({ endpoint: endpointFrom(io.env) });
    const print = (text: string, data: unknown) =>
      io.stdout(values.json ? `${JSON.stringify(data, null, 2)}\n` : text);

    switch (command) {
      case "events": {
        if (rest.length > 0) usage(`"events" takes no arguments.`);
        if (values.past && values.all) usage("Use --past or --all, not both.");
        const when = values.all ? "all" : values.past ? "past" : "upcoming";
        const events = await client.listEvents(
          when,
          parseLimit(values.limit, 20, 100),
        );
        print(formatEventList(events, color), { events });
        return ExitCode.Ok;
      }
      case "event": {
        const [slug, ...extra] = rest;
        if (slug === undefined || extra.length > 0)
          usage(`"event" takes one event slug.`);
        const event = await client.getEvent(slug);
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
          usage(`"rsvp" takes one event slug.`);
        const event = await client.getEvent(slug);
        if (!event.rsvpUrl) {
          throw new CliError(
            `${event.name} has no RSVP page.`,
            ExitCode.NotFound,
          );
        }
        io.stdout(`${event.rsvpUrl}\n`);
        if (!values.print && io.isTTY) await io.openUrl(event.rsvpUrl);
        return ExitCode.Ok;
      }
      case "about": {
        if (rest.length > 0) usage(`"about" takes no arguments.`);
        const community = await client.getCommunity();
        print(formatCommunity(community, color), community);
        return ExitCode.Ok;
      }
      default:
        return usage(`Unknown command "${command}".`);
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
