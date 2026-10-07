import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { createClient, type Client } from "./client.ts";
import {
  commandName,
  defaultEndpoint,
  endpointFrom,
  endpointVariable,
  legacyCommandName,
} from "./config.ts";
import { CliError, ExitCode } from "./errors.ts";
import {
  formatCommunity,
  formatEvent,
  formatEventList,
  formatSpeakers,
} from "./format.ts";

export type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** True when stdout is a terminal; color and hints are only for people. */
  isTTY: boolean;
  env: Record<string, string | undefined>;
  openUrl: (url: string) => Promise<void>;
  client?: Client;
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

Examples
  ${commandName} events                      What's coming up
  ${commandName} events --past --limit 5     The five most recent evenings
  ${commandName} event <slug> --json         One evening in full, for scripts and agents
  ${commandName} speakers react              Who has been on stage about react
  ${commandName} rsvp <slug>                 Open the evening's page to say you're in

Options
  --json        Print the public JSON contract instead of text
  -h, --help    Show this help
  -v, --version Show the version

Exit codes: 0 ok, 1 service error, 2 usage error, 3 event not found.
Set ${endpointVariable} to use another server (default ${defaultEndpoint}).
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
    if (values.help || command === undefined || command === "help") {
      io.stdout(help);
      return ExitCode.Ok;
    }

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
