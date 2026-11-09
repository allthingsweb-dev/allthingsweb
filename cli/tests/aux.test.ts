import { afterAll, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkedAuxEndpoint, retryAfterSeconds } from "../src/aux.ts";
import { run, type Io } from "../src/cli.ts";
import type { Fetch } from "../src/client.ts";
import { ExitCode } from "../src/errors.ts";

const code = "MINT-OTTER-4821";

const status = {
  holder: "card 12",
  queue_position: 3,
  cooldown_seconds: 0,
  frozen: false,
  scenes: ["house", "warm", "ocean"],
  colors: ["orange", "mint"],
};

const auxTools = [
  "aux_status",
  "set_scene",
  "set_color",
  "request_aux",
  "pass_aux",
];
const musicTools = ["list_tracks", "queue_track", "skip_track"];

const ok = (structuredContent: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  structuredContent,
});
const refused = (detail: object) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify(detail) }],
});

type Request = {
  url: string;
  authorization: string | undefined;
  method: string;
  params: { name?: string; arguments?: unknown };
};

/**
 * A fake hub: `answer` gets each JSON-RPC call and returns a tool result, or
 * a whole Response for HTTP-level answers.
 */
function fakeHub(
  answer: (method: string, name: string | undefined) => object | Response,
  { tools = [...auxTools, ...musicTools] }: { tools?: string[] } = {},
) {
  const requests: Request[] = [];
  const fetch: Fetch = async (url, init) => {
    if (typeof init.body !== "string") throw new Error("Expected JSON");
    const body = JSON.parse(init.body) as Omit<Request, "url">;
    const headers = init.headers as Record<string, string>;
    requests.push({
      url,
      authorization: headers["authorization"],
      method: body.method,
      params: body.params,
    });
    const answered =
      body.method === "tools/list"
        ? { tools: tools.map((name) => ({ name })) }
        : answer(body.method, body.params.name);
    if (answered instanceof Response) return answered;
    const json = JSON.stringify({ jsonrpc: "2.0", id: 1, result: answered });
    return new Response(`event: message\ndata: ${json}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  };
  return { fetch, requests };
}

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(
    homes.map((home) => rm(home, { recursive: true, force: true })),
  );
});
async function newHome() {
  const home = await mkdtemp(join(tmpdir(), "allthings-aux-"));
  homes.push(home);
  return home;
}

async function exec(
  argv: string[],
  {
    hub = fakeHub(() => ok(status)),
    env = { ALLTHINGS_AUX_CODE: code },
  }: {
    hub?: ReturnType<typeof fakeHub>;
    env?: Record<string, string>;
  } = {},
) {
  let stdout = "";
  let stderr = "";
  const io: Io = {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    isTTY: false,
    env: { ALLTHINGS_HOME: await newHome(), ...env },
    openUrl: async () => {},
    fetch: hub.fetch,
  };
  const exitCode = await run(["aux", ...argv], io);
  return { exitCode, stdout, stderr, requests: hub.requests };
}

describe("allthings aux", () => {
  test("has its own help, which the main help points to", async () => {
    for (const argv of [[], ["--help"], ["help"]]) {
      const { exitCode, stdout } = await exec(argv);
      expect(exitCode).toBe(ExitCode.Ok);
      expect(stdout).toContain("allthings aux color <name> [--zone <zone>]");
      expect(stdout).toContain("ALLTHINGS_AUX_CODE");
    }
    let main = "";
    await run(["--help"], {
      stdout: (text) => (main += text),
      stderr: () => {},
      isTTY: false,
      env: {},
      openUrl: async () => {},
    });
    expect(main).toContain("allthings aux <command> [--json]");
  });

  test("rejects bad arguments with exit code 2 before calling the hub", async () => {
    for (const argv of [
      ["scene"],
      ["scene", "ocean", "extra"],
      ["color"],
      ["queue"],
      ["status", "now"],
      ["pass", "x"],
      ["login"],
      ["login", "two words"],
      ["nope"],
    ]) {
      const { exitCode, stderr, requests } = await exec(argv);
      expect(exitCode).toBe(ExitCode.UsageError);
      expect(stderr).toContain("allthings");
      expect(requests).toEqual([]);
    }
  });

  test("never repeats an unknown command, which may be a code typed in the wrong place", async () => {
    const { exitCode, stderr } = await exec([code], { env: {} });
    expect(exitCode).toBe(ExitCode.UsageError);
    expect(stderr).not.toContain(code);
    expect(stderr).toContain('Run "allthings aux --help" for usage.');
  });

  test("asks for a code, with exit code 2, when there is none", async () => {
    const { exitCode, stderr, requests } = await exec(["status"], { env: {} });
    expect(exitCode).toBe(ExitCode.UsageError);
    expect(stderr).toBe(
      'allthings: No aux code yet. Run "allthings aux login <code>" with the code from your card.\n',
    );
    expect(requests).toEqual([]);
  });

  test("sends the code as a bearer token to the hub's MCP endpoint", async () => {
    const { exitCode, stdout, requests } = await exec(["scene", "ocean"]);
    expect(exitCode).toBe(ExitCode.Ok);
    expect(stdout).toBe('The room is on "ocean".\n');
    expect(requests).toEqual([
      {
        url: "https://aux.allthings.dev/mcp",
        authorization: `Bearer ${code}`,
        method: "tools/call",
        params: { name: "set_scene", arguments: { scene: "ocean" } },
      },
    ]);

    const other = await exec(["color", "mint", "--zone", "terrace"], {
      env: {
        ALLTHINGS_AUX_CODE: code,
        ALLTHINGS_AUX_URL: "http://localhost:8787/mcp",
      },
    });
    expect(other.stdout).toBe('terrace is "mint".\n');
    expect(other.requests[0]?.url).toBe("http://localhost:8787/mcp");
    expect(other.requests[0]?.params).toEqual({
      name: "set_color",
      arguments: { color: "mint", zone: "terrace" },
    });
  });

  test("login saves the code for its owner alone and never prints it", async () => {
    const home = await newHome();
    const env = { ALLTHINGS_HOME: home };
    const login = await exec(["login", code], { env });
    expect(login.exitCode).toBe(ExitCode.Ok);
    expect(login.stdout + login.stderr).not.toContain(code);
    expect(login.stdout).toContain(join(home, "aux-code"));

    const path = join(home, "aux-code");
    expect(await readFile(path, "utf8")).toBe(`${code}\n`);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }

    // Later commands use the saved code.
    const later = await exec(["status"], { env });
    expect(later.requests[0]?.authorization).toBe(`Bearer ${code}`);

    // --json says where, not what.
    const json = await exec(["login", code, "--json"], { env });
    expect(JSON.parse(json.stdout)).toEqual({ saved: true, path });
  });

  test("login --json stays valid JSON when the code matches a JSON word or the path", async () => {
    for (const tricky of ["true", "saved", "aux-code"]) {
      const home = await newHome();
      const json = await exec(["login", tricky, "--json"], {
        env: { ALLTHINGS_HOME: home },
      });
      expect(json.exitCode).toBe(ExitCode.Ok);
      const parsed = JSON.parse(json.stdout) as {
        saved: unknown;
        path: string;
      };
      expect(parsed.saved).toBe(true);
      for (const value of Object.values(parsed)) {
        if (typeof value === "string") expect(value).not.toContain(tricky);
      }
    }
  });

  test("login narrows a code file others could read to 0600", async () => {
    if (process.platform === "win32") return;
    const home = await newHome();
    const path = join(home, "aux-code");
    await writeFile(path, "OLD-CODE\n");
    await chmod(path, 0o644);
    await exec(["login", code], { env: { ALLTHINGS_HOME: home } });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toBe(`${code}\n`);
  });

  test("masks the code in anything the hub sends back", async () => {
    const hub = fakeHub(() => ({
      isError: true,
      content: [{ type: "text", text: `No such code ${code}` }],
    }));
    const { exitCode, stderr } = await exec(["status"], { hub });
    expect(exitCode).toBe(ExitCode.ServiceError);
    expect(stderr).toBe("allthings: No such code [your code]\n");
  });

  test("status shows the holder, your place in line and tonight's names", async () => {
    const { stdout } = await exec(["status"]);
    expect(stdout).toContain("card 12");
    expect(stdout).toContain("you're #3");
    expect(stdout).toContain("ready");
    expect(stdout).toContain("house, warm, ocean");
    expect(stdout).toContain("orange, mint");
    expect(stdout).not.toContain("\u001b[");

    expect(JSON.parse((await exec(["status", "--json"])).stdout)).toEqual(
      status,
    );

    const frozen = fakeHub(() =>
      ok({
        holder: null,
        queuePosition: null,
        cooldownSeconds: 9.2,
        frozen: true,
        scenes: [],
        colors: [],
      }),
    );
    const camel = (await exec(["status"], { hub: frozen })).stdout;
    expect(camel).toContain("nobody has it");
    expect(camel).toContain("you're not in line");
    expect(camel).toContain("10 s");
    expect(camel).toContain("paused by the host");
  });

  test("status prints the hub's own text when its result has another shape", async () => {
    const hub = fakeHub(() => ({
      content: [{ type: "text", text: "Aux: free. Line: empty." }],
      structuredContent: { auxHolder: "free" },
    }));
    const { exitCode, stdout } = await exec(["status"], { hub });
    expect(exitCode).toBe(ExitCode.Ok);
    expect(stdout).toBe("Aux: free. Line: empty.\n");
  });

  test("scenes lists tonight's scenes from status", async () => {
    const { stdout, requests } = await exec(["scenes"]);
    expect(stdout).toBe("house\nwarm\nocean\n");
    expect(requests[0]?.params.name).toBe("aux_status");
    expect(JSON.parse((await exec(["scenes", "--json"])).stdout)).toEqual({
      scenes: status.scenes,
    });
  });

  test("request and pass call their tools", async () => {
    const hub = fakeHub((_method, name) =>
      ok(name === "request_aux" ? { queue_position: 2 } : {}),
    );
    expect((await exec(["request"], { hub })).stdout).toBe(
      "You're #2 in line for the aux.\n",
    );
    expect((await exec(["pass"], { hub })).stdout).toBe(
      "You passed the aux on.\n",
    );
    expect(hub.requests.map((request) => request.params)).toEqual([
      { name: "request_aux", arguments: {} },
      { name: "pass_aux", arguments: {} },
    ]);
  });

  test("says what each of the hub's error codes means, with its exit code", async () => {
    const cases: [string[], object, string, ExitCode][] = [
      [
        ["scene", "ocean"],
        { code: "rate_limited", retry_after_seconds: 12.2 },
        "allthings: You're going a little fast: try again in 13 s.\n",
        ExitCode.ServiceError,
      ],
      [
        ["scene", "ocean"],
        { code: "frozen" },
        "allthings: The host has paused guest control for now. Try again in a bit.\n",
        ExitCode.ServiceError,
      ],
      [
        ["scene", "disco"],
        { code: "unknown_scene" },
        'allthings: Tonight has no scene called "disco". Run "allthings aux scenes" to see them.\n',
        ExitCode.UsageError,
      ],
      [
        ["color", "plaid"],
        { code: "unknown_color" },
        'allthings: Tonight has no color called "plaid". Run "allthings aux status" to see them.\n',
        ExitCode.UsageError,
      ],
      [
        ["skip"],
        { code: "not_holder" },
        'allthings: Only the person holding the aux can do that. Run "allthings aux request" to get in line.\n',
        ExitCode.ServiceError,
      ],
      [
        ["status"],
        { code: "unauthorized" },
        `allthings: The hub didn't accept your code. Check your card, then run "allthings aux login <code>" again.\n`,
        ExitCode.ServiceError,
      ],
      [
        ["status"],
        { code: "something_new", message: "The hub is napping." },
        "allthings: The hub is napping.\n",
        ExitCode.ServiceError,
      ],
    ];
    for (const [argv, detail, message, exitCode] of cases) {
      // The code may come in the text, as JSON, or as structured content.
      for (const result of [
        refused(detail),
        { isError: true, content: [], structuredContent: detail },
      ]) {
        const hub = fakeHub(() => result);
        const outcome = await exec(argv, { hub });
        expect(outcome.stderr).toBe(message);
        expect(outcome.exitCode).toBe(exitCode);
      }
    }
  });

  test("an HTTP 429 says when to try again, from Retry-After", async () => {
    const busy = (headers: Record<string, string>) =>
      fakeHub(() => new Response("", { status: 429, headers }));
    const seconds = await exec(["status"], {
      hub: busy({ "retry-after": "7" }),
    });
    expect(seconds.exitCode).toBe(ExitCode.ServiceError);
    expect(seconds.stderr).toBe(
      "allthings: The hub is busy: try again in 7 s.\n",
    );
    expect((await exec(["status"], { hub: busy({}) })).stderr).toBe(
      "allthings: The hub is busy: try again in a few seconds.\n",
    );

    const now = Date.parse("2026-11-11T20:00:00Z");
    expect(retryAfterSeconds("Wed, 11 Nov 2026 20:00:30 GMT", now)).toBe(30);
    expect(retryAfterSeconds(" 5 ", now)).toBe(5);
    expect(retryAfterSeconds("soon", now)).toBeUndefined();
    expect(retryAfterSeconds(null, now)).toBeUndefined();
  });

  test("an HTTP 401 is a code the hub didn't accept", async () => {
    const hub = fakeHub(() => new Response("", { status: 401 }));
    const { exitCode, stderr } = await exec(["status"], { hub });
    expect(exitCode).toBe(ExitCode.ServiceError);
    expect(stderr).toContain("The hub didn't accept your code.");
  });

  test("music commands check tools/list first and say when music isn't on", async () => {
    for (const argv of [["tracks"], ["queue", "night-drive"], ["skip"]]) {
      const hub = fakeHub(() => ok({}), { tools: auxTools });
      const { exitCode, stderr, requests } = await exec(argv, { hub });
      expect(exitCode).toBe(ExitCode.ServiceError);
      expect(stderr).toBe(
        "allthings: Music isn't on tonight, so there are no tracks to list, queue or skip.\n",
      );
      expect(requests.map((request) => request.method)).toEqual(["tools/list"]);
    }
  });

  test("music commands call their tools when music is on", async () => {
    const hub = fakeHub((_method, name) =>
      ok(
        name === "list_tracks"
          ? { tracks: [{ slug: "night-drive", title: "Night Drive" }] }
          : {},
      ),
    );
    expect((await exec(["tracks"], { hub })).stdout).toBe(
      "night-drive  Night Drive\n",
    );
    expect((await exec(["queue", "night-drive"], { hub })).stdout).toBe(
      "Queued night-drive.\n",
    );
    expect((await exec(["skip"], { hub })).stdout).toBe("Skipped.\n");
    expect(
      hub.requests
        .filter((request) => request.method === "tools/call")
        .map((request) => request.params),
    ).toEqual([
      { name: "list_tracks", arguments: {} },
      { name: "queue_track", arguments: { slug: "night-drive" } },
      { name: "skip_track", arguments: {} },
    ]);
  });
});

describe("the aux endpoint", () => {
  test("is refused before any request unless it's https or http to this machine", async () => {
    for (const url of [
      "http://aux.allthings.dev/mcp",
      "http://192.168.1.20:8787/mcp",
      "http://127.evil.com/mcp",
      "http://127.0.0.1.evil.com/mcp",
      "ftp://aux.allthings.dev/mcp",
      "not a url",
    ]) {
      const { exitCode, stderr, requests } = await exec(["status"], {
        env: { ALLTHINGS_AUX_CODE: code, ALLTHINGS_AUX_URL: url },
      });
      expect(exitCode).toBe(ExitCode.UsageError);
      expect(stderr).toContain("ALLTHINGS_AUX_URL");
      expect(stderr).not.toContain(code);
      expect(requests).toHaveLength(0);
    }
  });

  test("accepts https and http to a loopback host", () => {
    for (const url of [
      "https://aux.allthings.dev/mcp",
      "http://localhost:8787/mcp",
      "http://127.0.0.1:8787/mcp",
      "http://[::1]:8787/mcp",
    ]) {
      expect(checkedAuxEndpoint(url).href).toBe(new URL(url).href);
    }
  });

  test("treats a blank ALLTHINGS_AUX_URL as unset", async () => {
    const { exitCode, requests } = await exec(["status"], {
      env: { ALLTHINGS_AUX_CODE: code, ALLTHINGS_AUX_URL: "  " },
    });
    expect(exitCode).toBe(ExitCode.Ok);
    expect(requests[0]?.url).toBe("https://aux.allthings.dev/mcp");
  });
});
