import { describe, expect, test as bunTest } from "bun:test";
import { SQL } from "bun";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { migrate, readSeed } from "allthings-core/tests/support/database.ts";
import * as Effect from "effect/Effect";
import { mcpRequest, rpcMessage } from "./support/http.ts";
import { testStack } from "./support/stack.ts";

/**
 * The Worker against a real Postgres server, which PGlite is not: it
 * authenticates with SCRAM-SHA-256, so @effect/sql-pg hashes the password with
 * node:crypto inside workerd, as it will against Hyperdrive and Neon.
 *
 * Needs `WEB_TEST_POSTGRES_URL`, a superuser connection string such as CI's
 * service container provides. The test creates its own database there and
 * drops it afterwards.
 */

const serverUrl = process.env["WEB_TEST_POSTGRES_URL"];

if (serverUrl === undefined) {
  bunTest.skip("against a real Postgres (set WEB_TEST_POSTGRES_URL)", () => {});
} else {
  const database = `allthings_web_test_${process.pid}`;
  const admin = new SQL(serverUrl);
  await admin.unsafe(`CREATE DATABASE ${database}`);
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  const sql = new SQL(url.href);
  await migrate((statement) => sql.unsafe(statement));
  await sql.unsafe(await readSeed());
  await sql.close();

  const wrongPassword = new URL(url.href);
  wrongPassword.password = "not-the-password";
  const Stack = testStack({
    Web: { ORIGIN: "https://allthingsweb.dev", DATABASE_URL: url.href },
    WrongPassword: {
      ORIGIN: "https://allthingsweb.dev",
      DATABASE_URL: wrongPassword.href,
    },
  });

  const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
    providers: Cloudflare.providers(),
    dev: true,
  });
  const workers = beforeAll(deploy(Stack));
  afterAll(
    destroy(Stack).pipe(
      Effect.andThen(
        Effect.promise(async () => {
          await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
          await admin.close();
        }),
      ),
    ),
  );

  const urlOf = (outputs: Readonly<Record<string, unknown>>, name: string) => {
    const value = outputs[name];
    if (typeof value !== "string") throw new Error(`${name} has no URL`);
    return value;
  };

  describe("against a real Postgres", () => {
    test(
      "authenticates with SCRAM and reads",
      Effect.gen(function* () {
        const web = urlOf(yield* workers, "Web");
        const events = yield* Effect.promise(async () => {
          const response = await fetch(`${web}/api/v1/events`);
          expect(response.status).toBe(200);
          return ((await response.json()) as { events: Array<unknown> }).events;
        });
        expect(events).toHaveLength(5);
        const message = yield* Effect.promise(async () =>
          rpcMessage(
            await (
              await fetch(
                mcpRequest(`${web}/mcp`, {
                  jsonrpc: "2.0",
                  id: 1,
                  method: "tools/call",
                  params: { name: "list_speakers", arguments: {} },
                }),
              )
            ).text(),
          ),
        );
        expect(message).toMatchObject({
          result: { structuredContent: { speakers: expect.any(Array) } },
        });
      }),
    );

    test(
      "fails as unavailable with the wrong password",
      Effect.gen(function* () {
        const worker = urlOf(yield* workers, "WrongPassword");
        const response = yield* Effect.promise(() =>
          fetch(`${worker}/api/v1/events`),
        );
        expect(response.status).toBe(500);
      }),
    );
  });
}
