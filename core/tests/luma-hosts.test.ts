import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Layer } from "effect";
import { approvalToken } from "../src/approval.ts";
import {
  hostAddsInOrder,
  type Hosts,
  hostsPlan,
  hostsRequestProblem,
  LumaHosts,
} from "../src/luma/hosts.ts";
import type { EventRef } from "../src/luma/publish.ts";
import { LumaWrite } from "../src/luma/write.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * An evening's hosts on Luma (src/luma/hosts.ts): the plan is a pure diff,
 * approving sends exactly that plan and checks it took, and what Luma's API
 * can't do is refused by name. Against a fake Luma that answers as
 * public-api.luma.com/openapi.json documents; nothing here reaches Luma.
 * Every email is made up.
 */

const key = "test-luma-key";
const lumaEventId = "evt-madeUp1";
const draft: EventRef = { _tag: "Luma", lumaEventId };

const creator = {
  id: "usr-creator",
  email: "creator@example.com",
  name: "Made-up Creator",
};
const cohost = { id: "usr-cohost", email: "cohost@example.com", name: null };

const eventWith = (hosts: ReadonlyArray<typeof creator | typeof cohost>) => ({
  id: lumaEventId,
  access: "manage",
  user_id: creator.id,
  name: "All Things Made Up",
  start_at: "2026-10-28T01:00:00.000Z",
  end_at: "2026-10-28T04:30:00.000Z",
  timezone: "America/Los_Angeles",
  url: "https://luma.com/made-up",
  visibility: "private",
  cover_url: null,
  hosts,
});

const json = (value: unknown): Reply => ({ body: JSON.stringify(value) });

/** A host to add with no rights to manage the event: the default. */
const none = (email: string) => ({ email, access: "none" as const });

const now: Hosts = {
  lumaEventId,
  name: "All Things Made Up",
  url: "https://luma.com/made-up",
  visibility: "private",
  hosts: [
    { ...creator, creator: true },
    { ...cohost, creator: false },
  ],
};

let db: PGlite;
beforeAll(async () => {
  db = await seededDatabase();
});
afterAll(() => db.close());

const run = async <A, E>(
  f: (hosts: LumaHosts["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>>,
) => {
  const luma = fakeLumaBy((url) => url.pathname, replies);
  const layer = LumaHosts.layer.pipe(
    Layer.provide(LumaWrite.layer),
    Layer.provide(
      Layer.mergeAll(luma.layer, configFrom({ LUMA_API_KEY: key })),
    ),
    Layer.provide(sqlLayer(db)),
  );
  const exit = await Effect.runPromiseExit(
    settle(LumaHosts.use(f)).pipe(Effect.provide(layer)),
  );
  return { exit, requests: luma.requests };
};

const message = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

const paths = (requests: ReadonlyArray<{ method: string; url: string }>) =>
  requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);

describe("the plan", () => {
  test("is a pure diff: who is added and removed, nothing for what is already so", () => {
    expect(
      hostsPlan(now, {
        add: ["new@example.com", " NEW@example.com", "Creator@Example.com"].map(
          none,
        ),
        remove: ["usr-cohost"],
      }),
    ).toEqual({
      changes: [
        { action: "add", email: "new@example.com", access: "none" },
        { action: "remove", email: "cohost@example.com", name: null },
      ],
      gaps: [],
    });
    expect(
      hostsPlan(now, { add: ["creator@example.com"].map(none), remove: [] }),
    ).toEqual({ changes: [], gaps: [] });
  });

  test("names what Luma's API can't do, and plans nothing for it", () => {
    expect(
      hostsPlan(now, {
        add: ["usr-someone", "Ada Lovelace"].map(none),
        remove: ["creator@example.com", "nobody@example.com"],
      }),
    ).toEqual({
      changes: [],
      gaps: [
        {
          action: "add",
          who: "usr-someone",
          reason:
            "Luma's API adds a host by email only (hosts/add), and a Luma user's email isn't ours to see: give their email.",
        },
        {
          action: "add",
          who: "Ada Lovelace",
          reason:
            "Luma's API adds a host by email only (hosts/add), and this isn't one.",
        },
        {
          action: "remove",
          who: "creator@example.com",
          reason:
            "They made the event, and Luma's API can't remove its creator (hosts/remove).",
        },
        {
          action: "remove",
          who: "nobody@example.com",
          reason: "No host of this event is them.",
        },
      ],
    });
  });

  test("someone added by email and removed by Luma user id is a gap, not a quiet removal", () => {
    expect(
      hostsPlan(now, {
        add: ["Cohost@example.com"].map(none),
        remove: ["usr-cohost"],
      }),
    ).toEqual({
      changes: [],
      gaps: [
        {
          action: "remove",
          who: "usr-cohost",
          reason: "cohost@example.com is also asked to be added: give one.",
        },
      ],
    });
  });

  test("each host is added at its own access level, none unless asked", () => {
    expect(
      hostAddsInOrder([
        "luma",
        "hosts",
        "--add",
        "erik@example.com",
        "--access",
        "manager",
        "--add=co@example.com",
        "--add",
        "door@example.com",
        "--access=check-in",
        "--",
        "--add",
        "not-a-flag@example.com",
      ]),
    ).toEqual([
      { email: "erik@example.com", access: "manager" },
      { email: "co@example.com", access: "none" },
      { email: "door@example.com", access: "check-in" },
    ]);
    expect(
      hostAddsInOrder(["--access", "manager", "--add", "a@example.com"]),
    ).toBe("--access manager goes right after the --add it is for.");
    expect(
      hostAddsInOrder([
        "--add",
        "a@example.com",
        "--access",
        "none",
        "--access",
        "manager",
      ]),
    ).toBe("--access manager goes right after the --add it is for.");
    // Another flag between them ends the --add: the --access is refused.
    expect(
      hostAddsInOrder([
        "--add",
        "company@example.com",
        "--remove",
        "old@example.com",
        "--access",
        "manager",
      ]),
    ).toBe("--access manager goes right after the --add it is for.");
    expect(
      hostAddsInOrder(["--add", "a@example.com", "--access", "owner"]),
    ).toBe("--access is one of none, check-in, manager: owner");
    expect(
      hostsPlan(now, {
        add: [
          { email: "erik@example.com", access: "manager" },
          { email: "co@example.com", access: "none" },
        ],
        remove: [],
      }).changes,
    ).toEqual([
      { action: "add", email: "erik@example.com", access: "manager" },
      { action: "add", email: "co@example.com", access: "none" },
    ]);
  });

  test("a request with nothing in it, or someone both added and removed, is refused", () => {
    expect(
      hostsRequestProblem({
        add: [
          none("a@example.com"),
          { email: " A@example.com", access: "manager" },
        ],
        remove: [],
      }),
    ).toBe("A@example.com is added twice: give them once.");
    expect(hostsRequestProblem({ add: [], remove: [] })).toBe(
      "Nothing to change: give --add or --remove.",
    );
    expect(
      hostsRequestProblem({
        add: ["a@example.com"].map(none),
        remove: ["A@example.com "],
      }),
    ).toBe("A@example.com is both added and removed: give one.");
  });
});

describe("read and prepare", () => {
  test("lists the hosts, naming who made the event", async () => {
    const { exit } = await run((h) => h.read(draft), {
      "/v1/events/get": [json(eventWith([creator, cohost]))],
    });
    expect(value(exit)).toEqual(now);
  });

  test("reads, sends nothing, and prints the token for exactly the plan", async () => {
    const request = { add: ["new@example.com"].map(none), remove: [] };
    const { exit, requests } = await run((h) => h.prepare(draft, request), {
      "/v1/events/get": [json(eventWith([creator, cohost]))],
    });
    const prepared = value(exit);
    expect(prepared.changes).toEqual(hostsPlan(now, request).changes);
    expect(prepared.token).toBe(
      await Effect.runPromise(
        approvalToken({
          lumaEventId,
          visibility: "private",
          hosts: now.hosts,
          changes: prepared.changes,
        }),
      ),
    );
    expect(paths(requests)).toEqual(["GET /v1/events/get"]);
  });

  test("refuses hosts without their emails, as a viewer would see them", async () => {
    const { exit } = await run((h) => h.read(draft), {
      "/v1/events/get": [
        json({
          ...eventWith([]),
          hosts: [{ id: cohost.id, name: "Made-up Cohost" }],
        }),
      ],
    });
    expect(message(exit)).toBe(
      "Luma's answer to events/get has no hosts with their emails: it is not what its API documents for an event's manager.",
    );
  });

  test("finds an evening by its slug", async () => {
    const { exit } = await run(
      (h) => h.read({ _tag: "Slug", slug: "2026-09-01-draft-night" }),
      {
        "/v1/events/get": [
          json({
            ...eventWith([creator]),
            id: "evt-draft",
            visibility: "public",
          }),
        ],
      },
    );
    expect(value(exit).lumaEventId).toBe("evt-draft");
  });
});

describe("approve", () => {
  const request = {
    add: ["new@example.com"].map(none),
    remove: ["usr-cohost"],
  };
  const added = { id: "usr-new", email: "new@example.com", name: "New Host" };

  const tokenFor = async (asked = request) =>
    value(
      (
        await run((h) => h.prepare(draft, asked), {
          "/v1/events/get": [json(eventWith([creator, cohost]))],
        })
      ).exit,
    ).token;

  test("sends exactly the plan the dry run printed, and checks it took", async () => {
    const token = await tokenFor();
    const { exit, requests } = await run(
      (h) => h.approve(draft, request, token),
      {
        "/v1/events/get": [
          json(eventWith([creator, cohost])),
          json(eventWith([creator, added])),
        ],
        "/v1/events/hosts/add": [json({})],
        "/v1/events/hosts/remove": [json({})],
      },
    );
    value(exit);
    expect(paths(requests)).toEqual([
      "GET /v1/events/get",
      "POST /v1/events/hosts/add",
      "POST /v1/events/hosts/remove",
      "GET /v1/events/get",
    ]);
    expect(JSON.parse(requests[1]?.body ?? "")).toEqual({
      event_id: lumaEventId,
      email: "new@example.com",
      // Least privilege: shown on the page, no rights to manage it.
      access_level: "none",
    });
    expect(JSON.parse(requests[2]?.body ?? "")).toEqual({
      event_id: lumaEventId,
      email: "cohost@example.com",
    });
  });

  test("refuses a token for any other plan, and sends nothing", async () => {
    const token = await tokenFor({
      add: ["other@example.com"].map(none),
      remove: [],
    });
    const { exit, requests } = await run(
      (h) => h.approve(draft, request, token),
      { "/v1/events/get": [json(eventWith([creator, cohost]))] },
    );
    expect(message(exit)).toStartWith(
      `What would change has changed since ${token} was approved`,
    );
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
  });

  test("refuses what Luma's API can't do, by name, and sends nothing", async () => {
    const asked = { add: ["usr-someone"].map(none), remove: [] };
    const token = await tokenFor(asked);
    const { exit, requests } = await run(
      (h) => h.approve(draft, asked, token),
      {
        "/v1/events/get": [json(eventWith([creator, cohost]))],
      },
    );
    expect(message(exit)).toBe(
      "Luma's API can't do this as asked, so nothing was sent: add usr-someone: Luma's API adds a host by email only (hosts/add), and a Luma user's email isn't ours to see: give their email.",
    );
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
  });

  test("says which changes Luma didn't take", async () => {
    const token = await tokenFor();
    const { exit } = await run((h) => h.approve(draft, request, token), {
      "/v1/events/get": [
        json(eventWith([creator, cohost])),
        json(eventWith([creator, cohost, added])),
      ],
      "/v1/events/hosts/add": [json({})],
      "/v1/events/hosts/remove": [json({})],
    });
    expect(message(exit)).toBe(
      "Luma took the changes, but these don't read as sent: remove cohost@example.com. Read them with bun run luma hosts and set them again.",
    );
  });
});
