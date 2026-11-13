import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { seededDatabase } from "allthings-core/tests/support/database.ts";
import * as Effect from "effect/Effect";
import { proposeToolName } from "../src/mcp/propose.ts";
import { outcomeMessages } from "../src/proposals.ts";
import { mcpHeaders, mcpRequest, rpcMessage } from "./support/http.ts";
import { serve } from "./support/socket.ts";
import { hyperdriveTo, testStack } from "./support/stack.ts";

/**
 * propose_talk (src/mcp/propose.ts) on the MCP server, served by the
 * Worker in workerd with its page store, keeping proposals in PGlite over
 * TCP as prod keeps them through `INTAKE`. Open has the intake; Closed is
 * every other stage.
 */

const origin = "https://allthings.dev";
const db = await seededDatabase();
const database = await serve(db);

const Stack = testStack("allthings-web-propose-tool-test", {
  Open: {
    ORIGIN: origin,
    DATABASE_URL: database.url,
    INTAKE: hyperdriveTo(database.url),
    PROPOSALS_LIMIT: 50,
    PAGES: true,
  },
  Closed: { ORIGIN: origin, DATABASE_URL: database.url },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
);

type Worker = "Open" | "Closed";

/** A test that gets the running Workers' URLs. */
const it = (
  name: string,
  run: (urls: Record<Worker, string>) => Promise<void>,
) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => {
        const url = (worker: Worker) => {
          const value = outputs[worker];
          if (
            typeof value !== "string" ||
            !value.startsWith("http://localhost")
          ) {
            throw new Error(
              `${worker} is not running locally: ${String(value)}`,
            );
          }
          return value;
        };
        return run({ Open: url("Open"), Closed: url("Closed") });
      }),
    ),
  );

const proposal = {
  title: "Effect in production",
  abstract:
    "What a year of Effect in a payments service taught us about errors.",
  name: "Ada Lovelace",
  email: "ada@example.com",
  links: ["https://github.com/ada"],
};

interface Result {
  readonly isError?: boolean;
  readonly content: ReadonlyArray<{ readonly text: string }>;
  readonly structuredContent?: unknown;
}

/** Calls propose_talk on `base` with `args`, as a client with `headers` does. */
const propose = async (
  base: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = mcpHeaders,
): Promise<Result> => {
  const response = await fetch(
    mcpRequest(
      `${base}/mcp`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: proposeToolName, arguments: args },
      },
      headers,
    ),
  );
  return (rpcMessage(await response.text()) as { result: Result }).result;
};

const kept = async () =>
  (
    await db.query<{ title: string; source: string }>(
      `SELECT title, source FROM planning.proposals ORDER BY created_at, title`,
    )
  ).rows;

describe("propose_talk", () => {
  it("is listed as a tool that adds and destroys nothing", async ({ Open }) => {
    const response = await fetch(
      mcpRequest(`${Open}/mcp`, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    );
    const { tools } = (
      rpcMessage(await response.text()) as {
        result: {
          tools: Array<{ name: string; annotations: unknown }>;
        };
      }
    ).result;
    expect(
      tools.find((tool) => tool.name === proposeToolName)?.annotations,
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("keeps a proposal as an MCP client's, and says only that it was taken", async ({
    Open,
  }) => {
    const result = await propose(Open, proposal);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      received: true,
      message: outcomeMessages.Kept,
    });
    expect(await kept()).toEqual([
      { title: "Effect in production", source: "mcp" },
    ]);
  });

  it("names the command when the command sends it", async ({ Open }) => {
    await propose(
      Open,
      { ...proposal, title: "From the terminal" },
      { ...mcpHeaders, "user-agent": "allthings-cli/2.5.0" },
    );
    expect(await kept()).toContainEqual({
      title: "From the terminal",
      source: "cli",
    });
  });

  it("runs every call, never answering one from the store", async ({
    Open,
  }) => {
    const before = (await kept()).length;
    const args = { ...proposal, title: "Twice", email: "twice@example.com" };
    await propose(Open, args);
    // Decided, the same words are a new proposal: a kept answer would hide it.
    await db.exec(
      `UPDATE planning.proposals SET status = 'declined', decided_at = now(), decided_by = 'erik' WHERE title = 'Twice'`,
    );
    await propose(Open, args);
    expect((await kept()).length).toBe(before + 2);
    // Nor may it be asked through the store's own address.
    const stored = await fetch(
      `${Open}/_mcp/tools/${proposeToolName}?input=${encodeURIComponent(JSON.stringify(args))}`,
    );
    expect(stored.status).toBe(400);
    expect((await kept()).length).toBe(before + 2);
  });

  it("says each problem, and keeps nothing", async ({ Open }) => {
    const before = (await kept()).length;
    const result = await propose(Open, {
      ...proposal,
      abstract: "Short.",
      email: "nope",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      [
        outcomeMessages.Invalid,
        "abstract: The abstract is 6 characters; say a little more, at least 40.",
        'email: "nope" doesn\'t read as an email address.',
      ].join("\n"),
    );
    expect((await kept()).length).toBe(before);
  });

  it("is closed on every stage without the intake", async ({ Closed }) => {
    const result = await propose(Closed, proposal);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(outcomeMessages.Closed);
  });
});
