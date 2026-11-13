import { describe, expect, test } from "bun:test";
import { legacyNote, run, type Io } from "../src/cli.ts";
import type { Client } from "../src/client.ts";
import { CliError, ExitCode } from "../src/errors.ts";
import { formatDays } from "../src/format.ts";
import { event, fakeClient, guide, summary } from "./fixtures.ts";
import packageJson from "../package.json";

async function exec(
  argv: string[],
  {
    client = fakeClient(),
    isTTY = false,
    env = {},
    answers,
  }: {
    client?: Client;
    isTTY?: boolean;
    env?: Record<string, string>;
    /** A person's answers to the questions asked, in order; null ends the input. */
    answers?: Array<string | null>;
  } = {},
) {
  let stdout = "";
  let stderr = "";
  const opened: string[] = [];
  const asked: string[] = [];
  const io: Io = {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    isTTY,
    env,
    openUrl: async (url) => {
      opened.push(url);
    },
    client,
    ...(answers === undefined
      ? {}
      : {
          prompt: async (question: string) => {
            asked.push(question);
            return answers.shift() ?? null;
          },
        }),
  };
  const code = await run(argv, io);
  return { code, stdout, stderr, opened, asked };
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
      "grok mcp add allthings https://allthings.dev/mcp",
    );
    expect(stdout).toContain(
      `code --add-mcp '{"name":"allthings","type":"http","url":"https://allthings.dev/mcp"}'`,
    );
    expect(stdout).toContain(
      `{"mcpServers":{"allthings":{"url":"https://allthings.dev/mcp"}}}`,
    );
    expect(stdout).toContain(
      "list_events, get_event, list_speakers, get_community, get_guide",
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
      tools: [
        "list_events",
        "get_event",
        "list_speakers",
        "get_community",
        "get_guide",
        "coach_talk",
        "propose_talk",
      ],
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

  test("guide shows each star count under what it means, then each happening", async () => {
    const { code, stdout } = await exec(["guide"]);
    expect(code).toBe(ExitCode.Ok);
    expect(stdout).toBe(
      [
        "Happenings worth the trip.",
        "",
        "★★★ worth a special journey",
        "",
        "React Miami  Miami, Florida · 2027.04.29–30",
        "Two days of React's best speakers.",
        "by G2i · https://www.reactmiami.com/",
        "",
        "Chain React  Portland, Oregon · dates not announced yet",
        "The React Native conference.",
        "by Infinite Red · https://chainreactconf.com/",
        "",
        "★ worth a stop",
        "",
        "Demo Night  San Francisco · 2026.12.07",
        "Short demos.",
        "by Someone · https://demo.example.com/",
        "",
        "https://allthings.dev/guide",
        "",
      ].join("\n"),
    );
  });

  test.each([
    ["2027-04-29", "2027-04-29", "2027.04.29"],
    ["2027-04-29", "2027-04-30", "2027.04.29–30"],
    ["2027-04-29", "2027-05-02", "2027.04.29–05.02"],
    ["2027-12-30", "2028-01-02", "2027.12.30–2028.01.02"],
  ])("guide writes %s through %s as the site does: %s", (from, to, days) => {
    expect(formatDays(from, to)).toBe(days);
  });

  test("guide --json is the public contract, and takes no arguments", async () => {
    const { stdout } = await exec(["guide", "--json"]);
    expect(JSON.parse(stdout)).toEqual(guide);
    const { code, stderr } = await exec(["guide", "react"]);
    expect(code).toBe(ExitCode.UsageError);
    expect(stderr).toContain(`"guide" takes no arguments.`);
  });
});

describe("allthings propose", () => {
  const flags = [
    "propose",
    "--title",
    "Effect in production",
    "--abstract",
    "What a year of Effect taught us about errors in payments.",
    "--name",
    "Ada Lovelace",
    "--email",
    "ada@example.com",
  ];

  /** A client that records what it was asked to send. */
  const recording = () => {
    const sent: unknown[] = [];
    const client = fakeClient({
      proposeTalk: async (proposal) => {
        sent.push(proposal);
        return { received: true, message: "Thanks: your proposal is in." };
      },
    });
    return { sent, client };
  };

  test("sends what its options say, and prints the answer", async () => {
    const { sent, client } = recording();
    const { code, stdout } = await exec(
      [
        ...flags,
        "--format",
        "demo",
        "--link",
        "https://a.example",
        "--link",
        "https://b.example",
      ],
      { client },
    );
    expect(code).toBe(ExitCode.Ok);
    expect(stdout).toBe("Thanks: your proposal is in.\n");
    expect(sent).toEqual([
      {
        title: "Effect in production",
        abstract: "What a year of Effect taught us about errors in payments.",
        name: "Ada Lovelace",
        email: "ada@example.com",
        format: "demo",
        links: ["https://a.example", "https://b.example"],
      },
    ]);
  });

  test("prints the server's answer as JSON", async () => {
    const { stdout } = await exec([...flags, "--json"]);
    expect(JSON.parse(stdout)).toEqual({
      received: true,
      message:
        "Thanks: your proposal is in. Erik and Andre read every one, and reply by email.",
    });
  });

  test("outside a terminal, needs every required part as an option, and sends nothing", async () => {
    const { sent, client } = recording();
    const { code, stderr } = await exec(["propose", "--title", "Effect"], {
      client,
      answers: ["never asked"],
    });
    expect(code).toBe(ExitCode.UsageError);
    expect(stderr).toContain(
      '"propose" needs --abstract, --name, --email. Run it in a terminal to be asked for each.',
    );
    expect(sent).toEqual([]);
  });

  test("in a terminal, asks for each part, shows the proposal, and sends it on a yes", async () => {
    const { sent, client } = recording();
    const { code, asked, stdout } = await exec(["propose"], {
      client,
      isTTY: true,
      answers: [
        "Effect in production",
        "keynote",
        "lightning",
        "",
        "What a year of Effect taught us about errors in payments.",
        "Ada Lovelace",
        "ada@example.com",
        "",
        "https://a.example https://b.example",
        "Free Thursdays",
        "y",
      ],
    });
    expect(code).toBe(ExitCode.Ok);
    // A blank title is asked again; a wrong format too.
    expect(asked[0]).toBe("Title: ");
    expect(asked.at(-1)).toBe("Send it? [y/N] ");
    expect(stdout).toContain("Effect in production (lightning)");
    expect(sent).toEqual([
      {
        title: "Effect in production",
        abstract: "What a year of Effect taught us about errors in payments.",
        name: "Ada Lovelace",
        email: "ada@example.com",
        format: "lightning",
        links: ["https://a.example", "https://b.example"],
        notes: "Free Thursdays",
      },
    ]);
  });

  test("in a terminal, asks only for what its options left out, and sends nothing without a yes", async () => {
    const { sent, client } = recording();
    const { code, asked, stderr } = await exec(
      [
        "propose",
        "--title",
        "Effect",
        "--name",
        "Ada",
        "--email",
        "ada@example.com",
      ],
      {
        client,
        isTTY: true,
        answers: [
          "What a year of Effect taught us about errors in payments.",
          "n",
        ],
      },
    );
    expect(asked).toEqual([
      "Abstract, what it's about and what people will leave knowing: ",
      "Send it? [y/N] ",
    ]);
    expect(code).toBe(ExitCode.UsageError);
    expect(stderr).toBe("Nothing was sent.\n");
    expect(sent).toEqual([]);
    // --yes sends without asking.
    const yes = await exec([...flags, "--yes"], {
      client,
      isTTY: true,
      answers: [],
    });
    expect(yes.code).toBe(ExitCode.Ok);
    expect(sent).toHaveLength(1);
  });

  test("says what to fix, exit 2, when the server finds a problem", async () => {
    const client = fakeClient({
      proposeTalk: async () => {
        throw new CliError(
          "Some of the proposal needs another look: see each field's problem.\nemail: \"nope\" doesn't read as an email address.",
          ExitCode.UsageError,
        );
      },
    });
    const { code, stderr } = await exec(flags, { client });
    expect(code).toBe(ExitCode.UsageError);
    expect(stderr).toContain("doesn't read as an email address");
  });

  test("its options go with propose alone, and --format is one of three", async () => {
    expect((await exec(["events", "--title", "x"])).code).toBe(
      ExitCode.UsageError,
    );
    // aux reads none of them, so they stop it before it runs.
    const aux = await exec(["aux", "pass", "--yes"]);
    expect(aux.code).toBe(ExitCode.UsageError);
    expect(aux.stderr).toContain('go with "propose"');
    expect((await exec(["aux", "pass", "--abstract", "x"])).code).toBe(
      ExitCode.UsageError,
    );
    const format = await exec([...flags, "--format", "keynote"]);
    expect(format.code).toBe(ExitCode.UsageError);
    expect(format.stderr).toContain("--format is talk, lightning or demo.");
    const help = await exec(["propose", "--help"]);
    expect(help.stdout).toContain("An open door and a high bar");
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
