import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { normalizeCode } from "../src/codes.ts";
import { createFetch, type Hub, maxRequestBodySize } from "../src/mcp.ts";
import { AddressLimiter } from "../src/policy.ts";
import { testEnv, testHub } from "./support.ts";

const directory = mkdtempSync(join(import.meta.dir, ".tmp-mcp-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const hostToken = testEnv.AUX_HOST_TOKEN;
const guestTools = [
  "aux_status",
  "set_scene",
  "set_color",
  "request_aux",
  "pass_aux",
];
const hostTools = [
  "host_freeze",
  "host_set_scene",
  "host_clear_queue",
  "host_revoke_code",
];

type Rpc = {
  result?: {
    tools?: { name: string }[];
    isError?: boolean;
    content?: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
  };
  error?: { message: string };
};

/** The hub's HTTP face, called as the allthings CLI calls it. */
function client(hub: Hub, limiter = new AddressLimiter(10_000)) {
  const handle = createFetch(hub, limiter);
  const send = (
    body: string | ReadableStream,
    headers: Record<string, string> = {},
  ) =>
    handle(
      new Request("http://127.0.0.1:8787/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...headers,
        },
        body,
      }),
      "127.0.0.1",
    );

  async function rpc(
    method: string,
    params: Record<string, unknown>,
    auth?: string,
  ): Promise<Rpc> {
    const response = await send(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      auth === undefined ? {} : { authorization: `Bearer ${auth}` },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const json = (response.headers.get("content-type") ?? "").includes(
      "text/event-stream",
    )
      ? text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("")
      : text;
    return JSON.parse(json) as Rpc;
  }

  /** A tool's result; its text is the same JSON as its structured content. */
  async function call(
    name: string,
    args: Record<string, unknown>,
    auth?: string,
  ) {
    const { result, error } = await rpc(
      "tools/call",
      { name, arguments: args },
      auth,
    );
    if (result === undefined) throw new Error(error?.message ?? "no result");
    const data = result.structuredContent ?? {};
    expect(JSON.parse(result.content?.[0]?.text ?? "null")).toEqual(data);
    return { isError: result.isError === true, data };
  }

  return { handle, send, rpc, call };
}

const listed = async (hub: Hub, auth?: string) =>
  ((await client(hub).rpc("tools/list", {}, auth)).result?.tools ?? []).map(
    (tool) => tool.name,
  );

describe("tools/list", () => {
  test("anyone sees the five guest tools and nothing else", async () => {
    const { hub, guestCodes } = testHub();
    const { result } = await client(hub).rpc("tools/list", {});
    expect(result?.tools).toMatchSnapshot();
    expect(await listed(hub)).toEqual(guestTools);
    expect(await listed(hub, guestCodes[0])).toEqual(guestTools);
    // Music arrives in its own change.
    for (const music of ["list_tracks", "queue_track", "skip_track"]) {
      expect(await listed(hub)).not.toContain(music);
    }
  });

  test("the host token also sees the host tools", async () => {
    const { hub } = testHub();
    expect(await listed(hub, hostToken)).toEqual([...guestTools, ...hostTools]);
  });
});

describe("auth", () => {
  test("a missing, unknown, malformed or revoked code is unauthorized", async () => {
    const { hub, guestCodes } = testHub();
    const { call } = client(hub);
    const [code = ""] = guestCodes;
    const id = hub.identify(`Bearer ${code}`);
    expect(id.kind).toBe("guest");
    for (const auth of [
      undefined,
      "00000-00000",
      "not a code",
      `${hostToken}x`,
      hostToken.slice(0, -1),
      "x".repeat(300),
    ]) {
      for (const [name, args] of [
        ["aux_status", {}],
        ["set_scene", { scene: "house" }],
        ["set_color", { color: "mint" }],
        ["request_aux", {}],
        ["pass_aux", {}],
      ] as const) {
        expect(await call(name, args, auth)).toEqual({
          isError: true,
          data: {
            code: "unauthorized",
            message: expect.stringContaining("Bearer"),
          },
        });
      }
    }
    // A header that isn't Bearer names nobody either.
    expect(hub.identify(`Basic ${code}`)).toEqual({ kind: "anonymous" });
    expect(hub.identify(null)).toEqual({ kind: "anonymous" });
  });

  test("a guest code can't call a host tool", async () => {
    const { hub, guestCodes, bridge } = testHub();
    const { rpc } = client(hub);
    const answer = await rpc(
      "tools/call",
      { name: "host_freeze", arguments: { on: false } },
      guestCodes[0],
    );
    expect(answer.result?.structuredContent).toBeUndefined();
    expect(JSON.stringify(answer)).toContain("not found");
    expect(hub.policy.frozen).toBe(true);
    expect(bridge.changes).toEqual([]);
  });
});

describe("guest tools", () => {
  test("frozen at start until the host opens the lights", async () => {
    const { hub, guestCodes, bridge } = testHub();
    const { call } = client(hub);
    const [a = ""] = guestCodes;
    expect(await call("set_scene", { scene: "house" }, a)).toMatchObject({
      isError: true,
      data: { code: "frozen" },
    });
    expect(await call("request_aux", {}, a)).toMatchObject({
      data: { code: "frozen" },
    });
    expect((await call("aux_status", {}, a)).data["frozen"]).toBe(true);
    expect(await call("host_freeze", { on: false }, hostToken)).toEqual({
      isError: false,
      data: { frozen: false },
    });
    expect(bridge.changes).toEqual([]);
  });

  test("scenes and colors fade the configured zones, within the limits", async () => {
    const { hub, guestCodes, bridge, clock } = testHub();
    const { call } = client(hub);
    const [a = "", b = ""] = guestCodes;
    hub.policy.freeze(false);
    const config = hub.config;

    expect(await call("set_scene", { scene: " Sunset " }, a)).toEqual({
      isError: false,
      data: {
        scene: "sunset",
        zones: ["lounge", "terrace"],
        transition_seconds: 2,
        cooldown_seconds: 30,
      },
    });
    expect(bridge.changes).toEqual([
      {
        id: config.zones["lounge"] ?? "",
        command: {
          color: { xy: [0.58, 0.39] },
          brightness: 60,
          transitionMs: 2_000,
        },
      },
      {
        id: config.zones["terrace"] ?? "",
        command: {
          color: { xy: [0.46, 0.25] },
          brightness: 50,
          transitionMs: 2_000,
        },
      },
    ]);

    // The same code again: its 30 s cooldown.
    expect(await call("set_color", { color: "mint" }, a)).toEqual({
      isError: true,
      data: {
        code: "rate_limited",
        message: "Easy on the lights: try again in 30 s.",
        retry_after_seconds: 30,
      },
    });
    // Another code a second later: the room's 3 s flash guard.
    clock.now += 1_000;
    expect(
      await call("set_color", { color: "mint", zone: "terrace" }, b),
    ).toMatchObject({
      isError: true,
      data: { code: "rate_limited", retry_after_seconds: 2 },
    });
    clock.now += 2_000;
    expect(
      await call("set_color", { color: "MINT", zone: "terrace" }, b),
    ).toEqual({
      isError: false,
      data: {
        color: "mint",
        zone: "terrace",
        transition_seconds: 2,
        cooldown_seconds: 30,
      },
    });
    expect(bridge.changes.at(-1)).toEqual({
      id: config.zones["terrace"] ?? "",
      command: {
        color: { xy: [0.2, 0.45] },
        brightness: 60,
        transitionMs: 2_000,
      },
    });
    expect(bridge.changes).toHaveLength(3);
  });

  test("unknown names are refused before they cost anything", async () => {
    const { hub, guestCodes, bridge } = testHub();
    const { call } = client(hub);
    const [a = ""] = guestCodes;
    hub.policy.freeze(false);
    expect(await call("set_scene", { scene: "strobe" }, a)).toMatchObject({
      isError: true,
      data: {
        code: "unknown_scene",
        message: expect.stringContaining("house"),
      },
    });
    expect(await call("set_scene", { scene: "constructor" }, a)).toMatchObject({
      data: { code: "unknown_scene" },
    });
    expect(await call("set_color", { color: "ultraviolet" }, a)).toMatchObject({
      data: { code: "unknown_color" },
    });
    expect(
      await call("set_color", { color: "mint", zone: "roof" }, a),
    ).toMatchObject({
      data: { code: "unknown_zone" },
    });
    expect(bridge.changes).toEqual([]);
    expect((await call("set_color", { color: "mint" }, a)).isError).toBe(false);
  });

  test("a Bridge that doesn't answer is bridge_unavailable", async () => {
    const { hub, guestCodes, bridge } = testHub();
    hub.policy.freeze(false);
    bridge.state.failing = true;
    expect(
      await client(hub).call("set_scene", { scene: "house" }, guestCodes[0]),
    ).toMatchObject({ isError: true, data: { code: "bridge_unavailable" } });
    expect(hub.health()).toMatchObject({
      bridge: { last_error: "The Bridge didn't answer within 4000 ms" },
    });
  });

  test("a freeze during a guest's scene stops the zones it hasn't reached", async () => {
    const { hub, guestCodes, bridge } = testHub();
    const { call } = client(hub);
    hub.policy.freeze(false);
    let open = () => {};
    bridge.state.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const pending = call("set_scene", { scene: "sunset" }, guestCodes[0]);
    while (bridge.state.started === 0) await Bun.sleep(1);
    expect(await call("host_freeze", { on: true }, hostToken)).toEqual({
      isError: false,
      data: { frozen: true },
    });
    open();
    expect(await pending).toMatchObject({
      isError: true,
      data: {
        code: "frozen",
        message:
          "The host has paused guest control for now. Only lounge changed before the pause.",
      },
    });
    expect(bridge.changes.map((change) => change.id)).toEqual([
      hub.config.zones["lounge"] ?? "",
    ]);
  });

  test("aux_status says who holds the aux, your place and your cooldown", async () => {
    const { hub, guestCodes, clock } = testHub();
    const { call } = client(hub);
    const [a = "", b = ""] = guestCodes;
    hub.policy.freeze(false);
    expect(await call("request_aux", {}, a)).toEqual({
      isError: false,
      data: { queue_position: 0, queue_length: 0, turn_ends_in_seconds: 300 },
    });
    expect((await call("request_aux", {}, b)).data["queue_position"]).toBe(1);
    expect(await call("aux_status", {}, b)).toEqual({
      isError: false,
      data: {
        now_playing: null,
        holder: "someone",
        queue_position: 1,
        queue_length: 1,
        turn_ends_in_seconds: 300,
        cooldown_seconds: 0,
        frozen: false,
        scenes: [
          "house",
          "warm",
          "mint",
          "periwinkle",
          "orange",
          "ocean",
          "sunset",
          "terrace calm",
        ],
        colors: [
          "warm white",
          "cool white",
          "orange",
          "red",
          "pink",
          "purple",
          "periwinkle",
          "blue",
          "ocean",
          "mint",
          "green",
          "gold",
        ],
        zones: ["all", "lounge", "terrace"],
      },
    });
    expect(await call("aux_status", {}, b)).toEqual({
      isError: true,
      data: {
        code: "rate_limited",
        message: "Easy on the lights: try again in 5 s.",
        retry_after_seconds: 5,
      },
    });
    clock.now += 5_000;
    expect((await call("aux_status", {}, a)).data["holder"]).toBe("you");
  });

  test("only the holder passes the aux", async () => {
    const { hub, guestCodes } = testHub();
    const { call } = client(hub);
    const [a = "", b = ""] = guestCodes;
    hub.policy.freeze(false);
    await call("request_aux", {}, a);
    await call("request_aux", {}, b);
    expect(await call("pass_aux", {}, b)).toMatchObject({
      isError: true,
      data: { code: "not_holder" },
    });
    expect(await call("pass_aux", {}, a)).toEqual({
      isError: false,
      data: { holder: "someone" },
    });
    expect(await call("pass_aux", {}, b)).toEqual({
      isError: false,
      data: { holder: null },
    });
  });
});

describe("host tools", () => {
  test("set scenes while frozen, still behind the flash guard", async () => {
    const { hub, bridge, clock } = testHub();
    const { call } = client(hub);
    expect(await call("host_set_scene", { scene: "house" }, hostToken)).toEqual(
      {
        isError: false,
        data: { scene: "house", zones: ["all"], transition_seconds: 2 },
      },
    );
    expect(
      await call("host_set_scene", { scene: "warm" }, hostToken),
    ).toMatchObject({
      isError: true,
      data: { code: "rate_limited", retry_after_seconds: 3 },
    });
    clock.now += 3_000;
    expect(
      (await call("host_set_scene", { scene: "warm" }, hostToken)).isError,
    ).toBe(false);
    expect(bridge.changes).toHaveLength(2);
  });

  test("see the line, clear it, and revoke a code", async () => {
    const { hub, guestCodes } = testHub();
    const { call } = client(hub);
    const [a = "", b = ""] = guestCodes;
    hub.policy.freeze(false);
    await call("request_aux", {}, a);
    await call("request_aux", {}, b);
    const idOf = (code: string) => {
      const caller = hub.identify(`Bearer ${code}`);
      return caller.kind === "guest" ? caller.id : "";
    };
    const [idA, idB] = [idOf(a), idOf(b)];

    const status = await call("aux_status", {}, hostToken);
    expect(status.data["host"]).toMatchObject({
      holder_code_id: idA,
      line_code_ids: [idB],
    });

    expect(
      await call(
        "host_revoke_code",
        { code_hash_prefix: idA.slice(0, 8) },
        hostToken,
      ),
    ).toEqual({
      isError: false,
      data: { revoked_code_id: idA },
    });
    expect(await call("aux_status", {}, a)).toMatchObject({
      data: { code: "unauthorized" },
    });
    expect((await call("aux_status", {}, b)).data["holder"]).toBe("you");
    expect(
      await call(
        "host_revoke_code",
        { code_hash_prefix: "ffffffffffff" },
        hostToken,
      ),
    ).toMatchObject({
      isError: true,
    });

    expect(await call("host_clear_queue", {}, hostToken)).toEqual({
      isError: false,
      data: { cleared: 1 },
    });
  });
});

describe("HTTP guards", () => {
  test("a body over the limit is refused before it's parsed", async () => {
    const { hub, guestCodes } = testHub();
    const { send } = client(hub);
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "set_scene",
        arguments: { scene: "x".repeat(maxRequestBodySize) },
      },
    });
    expect(
      (await send(big, { authorization: `Bearer ${guestCodes[0]}` })).status,
    ).toBe(413);
    // Streamed, with no length to check up front.
    const streamed = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    expect((await send(streamed)).status).toBe(413);
  });

  test("each address is limited before any code is read", async () => {
    const { hub } = testHub();
    const { send } = client(hub, new AddressLimiter(2));
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const from = (address: string) => ({ "cf-connecting-ip": address });
    expect((await send(body, from("192.0.2.1"))).status).toBe(200);
    expect((await send(body, from("192.0.2.1"))).status).toBe(200);
    const refused = await send(body, from("192.0.2.1"));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await send(body, from("192.0.2.2"))).status).toBe(200);
  });

  test("browser origins are refused", async () => {
    const { hub } = testHub();
    const response = await client(hub).send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
      { origin: "https://example.com" },
    );
    expect(response.status).toBe(403);
  });

  test("/healthz answers on this machine only", async () => {
    const { hub } = testHub();
    const { handle } = client(hub);
    const local = await handle(
      new Request("http://127.0.0.1:8787/healthz"),
      "127.0.0.1",
    );
    expect(local.status).toBe(200);
    expect(await local.json()).toMatchObject({
      ok: true,
      frozen: true,
      codes: 3,
    });
    const tunneled = await handle(
      new Request("http://127.0.0.1:8787/healthz", {
        headers: { "cf-connecting-ip": "192.0.2.1", "cf-ray": "abc" },
      }),
      "127.0.0.1",
    );
    expect(tunneled.status).toBe(404);
    expect(
      (await handle(new Request("http://127.0.0.1:8787/"), "127.0.0.1")).status,
    ).toBe(404);
  });
});

describe("audit log", () => {
  test("records every call by code id, never by code", async () => {
    const path = join(directory, "aux.log.jsonl");
    const { hub, guestCodes } = testHub({ logPath: path });
    const { call } = client(hub);
    const [a = ""] = guestCodes;
    hub.policy.freeze(false);
    await call("set_scene", { scene: "house" }, a);
    await call("set_scene", { scene: a }, a);
    await call("aux_status", {}, "00000-00000");
    await call("host_freeze", { on: true }, hostToken);

    const text = readFileSync(path, "utf8");
    for (const secret of [a, normalizeCode(a) ?? "", hostToken]) {
      expect(text).not.toContain(secret);
    }
    const entries = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(
      entries.map(({ tool, caller, outcome }) => ({ tool, caller, outcome })),
    ).toEqual([
      { tool: "set_scene", caller: "guest", outcome: "ok" },
      { tool: "set_scene", caller: "guest", outcome: "unknown_scene" },
      { tool: "aux_status", caller: "anonymous", outcome: "unauthorized" },
      { tool: "host_freeze", caller: "host", outcome: "ok" },
    ]);
    expect(entries[0]?.["code_id"]).toMatch(/^[0-9a-f]{12}$/);
  });
});
