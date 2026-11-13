import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { seededDatabase } from "allthings-core/tests/support/database.ts";
import * as Effect from "effect/Effect";
import { outcomeMessages, proposalBodyLimit } from "../src/proposals.ts";
import { serve } from "./support/socket.ts";
import { hyperdriveTo, testStack } from "./support/stack.ts";

/**
 * `POST /api/v1/proposals` (src/v1/proposals.ts), served by the Worker in
 * workerd, keeping proposals in PGlite over TCP as it will through the
 * `INTAKE` Hyperdrive: Open has it and a rate limit of three a minute, as
 * prod does; Closed is every other stage, which has neither.
 */

const origin = "https://allthings.dev";
const db = await seededDatabase();
const database = await serve(db);

const Stack = testStack("allthings-web-proposals-test", {
  Open: {
    ORIGIN: origin,
    INTAKE: hyperdriveTo(database.url),
    PROPOSALS_LIMIT: 3,
  },
  Closed: { ORIGIN: origin },
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

let address = 0;

/** POSTs `body` from an address of its own (rate limits count by address), unless `from` names one. */
const post = (
  base: string,
  body: string,
  headers: Record<string, string> = {},
  from = `203.0.113.${++address}`,
) =>
  fetch(`${base}/api/v1/proposals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": from,
      ...headers,
    },
    body,
  });

const kept = async () =>
  (
    await db.query<{ title: string; source: string; status: string }>(
      `SELECT title, source, status FROM planning.proposals ORDER BY created_at, title`,
    )
  ).rows;

describe("POST /api/v1/proposals", () => {
  it("keeps a proposal, from the API, and says only that it was taken", async ({
    Open,
  }) => {
    const response = await post(Open, JSON.stringify(proposal));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      received: true,
      message: outcomeMessages.Kept,
    });
    expect(await kept()).toEqual([
      { title: "Effect in production", source: "api", status: "new" },
    ]);
    // Sent again, it is kept once, and the answer is the same.
    const again = await post(Open, JSON.stringify(proposal));
    expect(again.status).toBe(202);
    expect(await kept()).toHaveLength(1);
  });

  it("says each problem, and keeps nothing", async ({ Open }) => {
    const response = await post(
      Open,
      JSON.stringify({ ...proposal, abstract: "Short.", email: "nope" }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: outcomeMessages.Invalid,
      problems: [
        {
          field: "abstract",
          message:
            "The abstract is 6 characters; say a little more, at least 40.",
        },
        {
          field: "email",
          message: '"nope" doesn\'t read as an email address.',
        },
      ],
    });
  });

  it("refuses what isn't a JSON proposal of this site's", async ({ Open }) => {
    expect(
      (
        await post(Open, JSON.stringify(proposal), {
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect((await post(Open, "{not json")).status).toBe(400);
    expect(
      (
        await post(
          Open,
          JSON.stringify({ ...proposal, notes: "x".repeat(proposalBodyLimit) }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await post(Open, JSON.stringify(proposal), {
          origin: "https://elsewhere.example",
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${Open}/api/v1/proposals`)).status).not.toBe(200);
  });

  it("counts each address: three a minute", async ({ Open }) => {
    const statuses: Array<number> = [];
    for (const title of ["One", "Two", "Three", "Four"]) {
      const response = await post(
        Open,
        // Without links, which the driver must send as an empty list.
        JSON.stringify({ ...proposal, title, links: undefined }),
        {},
        "198.51.100.7",
      );
      statuses.push(response.status);
      if (response.status === 429) {
        expect(response.headers.get("retry-after")).toBe("60");
        expect(await response.json()).toEqual({
          error: outcomeMessages.Limited,
        });
      }
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it("refuses past the day's limit, saying to try tomorrow", async ({
    Open,
  }) => {
    await db.exec(`
      INSERT INTO planning.proposals (title, abstract, name, email, source)
      SELECT 'Flood ' || n, 'An abstract long enough to read, at forty characters.', 'Someone', 'someone' || n || '@example.com', 'site'
      FROM generate_series(1, 100 - (SELECT count(*)::int FROM planning.proposals)) AS n`);
    try {
      const response = await post(
        Open,
        JSON.stringify({ ...proposal, title: "After the flood" }),
      );
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: outcomeMessages.Full });
    } finally {
      await db.exec(
        `DELETE FROM planning.proposals WHERE title LIKE 'Flood %'`,
      );
    }
  });

  it("is closed on every stage without the intake, after reading it in", async ({
    Closed,
  }) => {
    const response = await post(Closed, JSON.stringify(proposal));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: outcomeMessages.Closed });
    const invalid = await post(Closed, JSON.stringify({}));
    expect(invalid.status).toBe(422);
  });
});
