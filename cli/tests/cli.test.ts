import { describe, expect, test } from "bun:test";
import { legacyNote, run, type Io } from "../src/cli.ts";
import type { Client } from "../src/client.ts";
import { CliError, ExitCode } from "../src/errors.ts";
import { event, fakeClient, summary } from "./fixtures.ts";
import packageJson from "../package.json";

async function exec(
  argv: string[],
  {
    client = fakeClient(),
    isTTY = false,
    env = {},
  }: {
    client?: Client;
    isTTY?: boolean;
    env?: Record<string, string>;
  } = {},
) {
  let stdout = "";
  let stderr = "";
  const opened: string[] = [];
  const io: Io = {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    isTTY,
    env,
    openUrl: async (url) => {
      opened.push(url);
    },
    client,
  };
  const code = await run(argv, io);
  return { code, stdout, stderr, opened };
}

describe("allthings", () => {
  test("on its own, shows the next evening and commands that run as typed", async () => {
    const calls: unknown[] = [];
    const client = fakeClient({
      listEvents: async (when, limit) => {
        calls.push([when, limit]);
        return when === "upcoming" ? [summary] : [];
      },
    });
    const { code, stdout } = await exec([], { client });
    expect(code).toBe(ExitCode.Ok);
    expect(calls).toEqual([
      ["upcoming", 1],
      ["past", 1],
    ]);
    expect(stdout).toContain("Next up\nEffect San Francisco [upcoming]");
    expect(stdout).toContain("rsvp  https://lu.ma/event/evt-1");
    expect(stdout).toMatch(/allthings event next +The talks/);
    expect(stdout).toMatch(/allthings rsvp next +Say you're in/);
    expect(stdout).toMatch(/allthings mcp +Add allthings to your agent/);
    // Nothing to fill in: every suggestion runs as typed.
    expect(stdout).not.toContain("<");
  });

  test("on its own with nothing scheduled, says where the next one lands and shows the last", async () => {
    const past = { ...summary, status: "past" as const };
    const client = fakeClient({
      listEvents: async (when) => (when === "upcoming" ? [] : [past]),
    });
    const { code, stdout } = await exec([], { client });
    expect(code).toBe(ExitCode.Ok);
    expect(stdout).toContain(
      "Nothing is on the calendar yet. New evenings land on https://luma.com/allthings first.",
    );
    expect(stdout).toContain("Last time\nEffect San Francisco\n");
    expect(stdout).toMatch(/allthings event latest +Its talks/);
    expect(stdout).not.toContain("event next");
  });

  test("on its own with --json, gives the next and latest evenings", async () => {
    const client = fakeClient({
      listEvents: async (when) => (when === "upcoming" ? [] : [summary]),
    });
    const { stdout } = await exec(["--json"], { client, isTTY: true });
    expect(JSON.parse(stdout)).toEqual({ next: null, latest: summary });
  });

  test("next and latest stand for an evening wherever a slug goes", async () => {
    const asked: string[] = [];
    const client = fakeClient({
      listEvents: async (when) => [
        { ...summary, slug: when === "upcoming" ? "soon" : "before" },
      ],
      getEvent: async (slug) => {
        asked.push(slug);
        return event;
      },
    });
    await exec(["event", "next"], { client });
    await exec(["event", "latest"], { client });
    await exec(["rsvp", "next", "--print"], { client });
    await exec(["event", summary.slug], { client });
    expect(asked).toEqual(["soon", "before", "soon", summary.slug]);
  });

  test("next with nothing scheduled is not found, with where to look", async () => {
    const client = fakeClient({ listEvents: async () => [] });
    const { code, stderr } = await exec(["event", "next"], { client });
    expect(code).toBe(ExitCode.NotFound);
    expect(stderr).toContain("Nothing is on the calendar yet.");
    expect(stderr).toContain("https://luma.com/allthings");
  });

  test("events with nothing scheduled says where the next one lands", async () => {
    const client = fakeClient({ listEvents: async () => [] });
    const { stdout } = await exec(["events"], { client });
    expect(stdout).toBe(
      'Nothing is on the calendar yet. New evenings land on https://luma.com/allthings first. "allthings events --past" shows the evenings so far.\n',
    );
    // Scripts still get the contract, without waiting on the community.
    const asked: string[] = [];
    const json = fakeClient({
      listEvents: async () => [],
      getCommunity: async () => {
        asked.push("community");
        throw new Error("not needed");
      },
    });
    expect(
      JSON.parse((await exec(["events", "--json"], { client: json })).stdout),
    ).toEqual({ events: [] });
    expect(asked).toEqual([]);
  });

  test("on its own, suggests rsvp only when the next evening has an RSVP page", async () => {
    const client = fakeClient({
      listEvents: async (when) =>
        when === "upcoming" ? [{ ...summary, rsvpUrl: null }] : [],
    });
    const { stdout } = await exec([], { client });
    expect(stdout).toContain("allthings event next");
    expect(stdout).not.toContain("rsvp next");
  });

  test("mcp gives a line for each agent, reading nothing", async () => {
    const offline = fakeClient({
      listEvents: async () => {
        throw new Error("mcp should not read the server");
      },
    });
    const { code, stdout } = await exec(["mcp"], { client: offline });
    expect(code).toBe(ExitCode.Ok);
    expect(stdout).toContain(
      "claude mcp add --transport http allthings https://allthings.dev/mcp",
    );
    expect(stdout).toContain(
      "codex mcp add allthings --url https://allthings.dev/mcp",
    );
    expect(stdout).toContain(
      `code --add-mcp '{"name":"allthings","type":"http","url":"https://allthings.dev/mcp"}'`,
    );
    expect(stdout).toContain(
      `{"mcpServers":{"allthings":{"url":"https://allthings.dev/mcp"}}}`,
    );
    expect(stdout).toContain(
      "list_events, get_event, list_speakers, get_community",
    );
  });

  test("mcp names the server the environment points at, quoted for the shell", async () => {
    const url = "http://localhost:8787/mcp?who=it's";
    const { stdout } = await exec(["mcp"], {
      env: { ALLTHINGS_MCP_URL: url },
    });
    expect(stdout).toContain(
      `claude mcp add --transport http allthings 'http://localhost:8787/mcp?who=it'\\''s'`,
    );
    expect(stdout).not.toContain("https://allthings.dev/mcp");
  });

  test("mcp --json gives the server and its tools", async () => {
    const { stdout } = await exec(["mcp", "--json"], { isTTY: true });
    expect(JSON.parse(stdout)).toEqual({
      name: "allthings",
      url: "https://allthings.dev/mcp",
      transport: "streamable-http",
      tools: ["list_events", "get_event", "list_speakers", "get_community"],
    });
  });

  test("prints help with examples and exit codes", async () => {
    for (const argv of [["--help"], ["help"]]) {
      const { code, stdout } = await exec(argv);
      expect(code).toBe(ExitCode.Ok);
      expect(stdout).toContain("allthings events [--past | --all]");
      expect(stdout).toContain(
        "Exit codes: 0 ok, 1 service error, 2 usage error, 3 event not found.",
      );
      expect(stdout).toContain("allthings mcp ");
      // Pointing at another server is for "mcp" to explain, not the first screen.
      expect(stdout).not.toContain("ALLTHINGS_MCP_URL");
    }
  });

  test("prints its version", async () => {
    const { stdout } = await exec(["--version"]);
    expect(stdout).toBe(`${packageJson.version}\n`);
    // SemVer, including prerelease tags such as 2.0.0-alpha.1.
    expect(stdout).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\n$/);
  });

  test("rejects bad usage with exit code 2 and a pointer to help", async () => {
    for (const argv of [
      ["nope"],
      ["event"],
      ["events", "--past", "--all"],
      ["events", "--limit", "0"],
      ["events", "--unknown"],
      ["events", "--zone", "terrace"],
      ["about", "--zone", "terrace"],
      ["mcp", "claude"],
      ["--past"],
      ["--limit", "3"],
    ]) {
      const { code, stderr } = await exec(argv);
      expect(code).toBe(ExitCode.UsageError);
      expect(stderr).toContain('Run "allthings --help" for usage.');
    }
  });

  test("suggests the command or option a typo meant", async () => {
    const command = await exec(["evnts"]);
    expect(command.code).toBe(ExitCode.UsageError);
    expect(command.stderr).toBe(
      'allthings: Unknown command "evnts". Did you mean "allthings events"?\nRun "allthings --help" for usage.\n',
    );
    const option = await exec(["events", "--jsn"]);
    expect(option.code).toBe(ExitCode.UsageError);
    expect(option.stderr).toContain(
      'Unknown option "--jsn". Did you mean "--json"?',
    );
    // In its own words, without node's advice about positionals.
    expect(option.stderr).not.toContain("positional");
    expect((await exec(["frobnicate"])).stderr).not.toContain("Did you mean");
  });

  test("suggests an aux command without repeating what was typed", async () => {
    const near = await exec(["aux", "stauts"]);
    expect(near.code).toBe(ExitCode.UsageError);
    expect(near.stderr).toContain('Did you mean "allthings aux status"?');
    expect(near.stderr).not.toContain("stauts");
    // A guest's code typed in the wrong place is never echoed.
    const code = await exec(["aux", "K7QX-29MB"]);
    expect(code.stderr).not.toContain("K7QX");
    expect(code.stderr).not.toContain("Did you mean");
  });

  test("lists upcoming events by default and passes filters through", async () => {
    const calls: unknown[] = [];
    const client = fakeClient({
      listEvents: async (when, limit) => {
        calls.push([when, limit]);
        return [summary];
      },
    });
    const { stdout } = await exec(["events"], { client });
    await exec(["events", "--past", "--limit", "5"], { client });
    expect(calls).toEqual([
      ["upcoming", 20],
      ["past", 5],
    ]);
    expect(stdout).toContain("Effect San Francisco [upcoming]");
    expect(stdout).toContain("Wed, Sep 30, 2026, 5:30 PM PDT · CodeRabbit");
    expect(stdout).toContain("rsvp  https://lu.ma/event/evt-1");
  });

  test("marks an evening we share with who organizes it", async () => {
    const shared = {
      ...summary,
      curation: "shared" as const,
      organizer: { name: "Mastra", url: "https://mastra.ai/" },
    };
    const client = fakeClient({
      listEvents: async () => [shared],
      getEvent: async () => ({ ...event, ...shared }),
    });
    expect((await exec(["events"], { client })).stdout).toContain(
      "Effect San Francisco [upcoming] shared · by Mastra",
    );
    const { stdout } = await exec(["event", summary.slug], { client });
    expect(stdout).toContain("shared · by Mastra");
    expect(stdout).toContain("by     https://mastra.ai/");
    // Ours says nothing of it.
    expect((await exec(["events"])).stdout).not.toContain("shared");
    // Shared without a named organizer still says so.
    const unnamed = fakeClient({
      listEvents: async () => [{ ...shared, organizer: null }],
    });
    expect((await exec(["events"], { client: unnamed })).stdout).toContain(
      "Effect San Francisco [upcoming] shared\n",
    );
  });

  test("--json prints exactly the public contract with no color", async () => {
    const { stdout } = await exec(["event", summary.slug, "--json"], {
      isTTY: true,
    });
    expect(JSON.parse(stdout)).toEqual(event);
    expect(stdout).not.toContain("\u001b[");
  });

  test("colors only for terminals without NO_COLOR", async () => {
    expect((await exec(["events"], { isTTY: true })).stdout).toContain(
      "\u001b[",
    );
    expect((await exec(["events"], { isTTY: false })).stdout).not.toContain(
      "\u001b[",
    );
    expect(
      (await exec(["events"], { isTTY: true, env: { NO_COLOR: "1" } })).stdout,
    ).not.toContain("\u001b[");
  });

  test("maps a missing event to exit code 3", async () => {
    const client = fakeClient({
      getEvent: async () => {
        throw new CliError(
          'No published event has the slug "x".',
          ExitCode.NotFound,
        );
      },
    });
    const { code, stderr } = await exec(["event", "x"], { client });
    expect(code).toBe(ExitCode.NotFound);
    expect(stderr).toBe('allthings: No published event has the slug "x".\n');
  });

  test("rsvp prints the link and opens it only for a person at a terminal", async () => {
    const atTerminal = await exec(["rsvp", summary.slug], { isTTY: true });
    expect(atTerminal.stdout).toBe("https://lu.ma/event/evt-1\n");
    expect(atTerminal.opened).toEqual(["https://lu.ma/event/evt-1"]);

    expect(
      (await exec(["rsvp", summary.slug], { isTTY: false })).opened,
    ).toEqual([]);
    expect(
      (await exec(["rsvp", summary.slug, "--print"], { isTTY: true })).opened,
    ).toEqual([]);
  });

  test("open prints the evening's page and opens it only for a person at a terminal", async () => {
    const atTerminal = await exec(["open", summary.slug], { isTTY: true });
    expect(atTerminal.stdout).toBe(`${event.url}\n`);
    expect(atTerminal.opened).toEqual([event.url]);

    expect((await exec(["open", "latest"], { isTTY: false })).opened).toEqual(
      [],
    );
    expect(
      (await exec(["open", summary.slug, "--print"], { isTTY: true })).opened,
    ).toEqual([]);
  });

  test("open takes exactly one evening", async () => {
    const none = await exec(["open"]);
    expect(none.code).toBe(ExitCode.UsageError);
    expect(none.stderr).toContain(
      '"open" takes one event slug, or next or latest.',
    );
    expect((await exec(["open", "a", "b"])).code).toBe(ExitCode.UsageError);
  });

  test("suggests open for a typo", async () => {
    const { stderr } = await exec(["opne", summary.slug]);
    expect(stderr).toContain('Did you mean "allthings open"?');
  });

  test("rsvp fails clearly when an event has no RSVP page", async () => {
    const client = fakeClient({
      getEvent: async () => ({ ...event, rsvpUrl: null }),
    });
    const { code, stderr } = await exec(["rsvp", summary.slug], { client });
    expect(code).toBe(ExitCode.NotFound);
    expect(stderr).toContain("has no RSVP page");
  });

  test("searches speakers and describes the community", async () => {
    const speakers = await exec(["speakers", "ada"]);
    expect(speakers.stdout).toContain("Ada Lovelace · Engineer");
    const about = await exec(["about"]);
    expect(about.stdout).toContain("https://discord.gg/B3Sm4b5mfD");
  });
});

describe("atw, the old name", () => {
  test("prints a note on stderr and otherwise behaves the same", async () => {
    const io = (legacy: boolean) => {
      let stdout = "";
      let stderr = "";
      const value: Io = {
        stdout: (text) => (stdout += text),
        stderr: (text) => (stderr += text),
        isTTY: false,
        env: {},
        openUrl: async () => {},
        client: fakeClient(),
        legacy,
      };
      return { value, out: () => ({ stdout, stderr }) };
    };
    const legacy = io(true);
    const current = io(false);
    expect(await run(["events", "--json"], legacy.value)).toBe(ExitCode.Ok);
    expect(await run(["events", "--json"], current.value)).toBe(ExitCode.Ok);
    expect(legacy.out().stdout).toBe(current.out().stdout);
    expect(legacy.out().stderr).toBe(legacyNote);
    expect(current.out().stderr).toBe("");
    expect(legacyNote).toContain("atw is now allthings");
  });
});
