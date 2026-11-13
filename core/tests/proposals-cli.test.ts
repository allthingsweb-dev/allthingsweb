import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import * as Migrations from "../src/migrator.ts";
import { submitProposal } from "../src/proposal-intake.ts";
import { readProposal } from "../src/proposals.ts";
import { cliUrlFor, readSeed } from "./support/database.ts";

/**
 * `bun run proposals` (scripts/proposals.ts) end to end against a real
 * Postgres, through `@effect/sql-pg` as production runs it, and
 * submitProposal through the same driver: what PGlite's in-process client
 * can't show, like how a statement's parameters are encoded (an empty
 * array has no type the driver can infer). The module itself is tested in
 * proposals.test.ts.
 *
 * Needs `CORE_TEST_POSTGRES_URL`, as tests/postgres.test.ts does; the test
 * makes its own database there and drops it afterwards. In the studio's
 * run (`bun run test:studio`) the CLI signs in as the studio role.
 */

const serverUrl = process.env["CORE_TEST_POSTGRES_URL"];
const core = new URL("../", import.meta.url).pathname;

if (serverUrl === undefined) {
  test.skip("bun run proposals (set CORE_TEST_POSTGRES_URL)", () => {});
} else {
  const admin = new SQL(serverUrl);
  const database = `allthings_core_test_${process.pid}_proposals`;
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  const databaseUrl = url.href;
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${database}`);
  await Effect.runPromise(
    Migrations.run().pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(databaseUrl) })),
    ),
  );
  const seeded = new SQL(databaseUrl);
  await seeded.unsafe(await readSeed());
  const cliUrl = await cliUrlFor(
    { unsafe: (query, values) => seeded.unsafe(query, [...(values ?? [])]) },
    databaseUrl,
  );
  afterAll(async () => {
    await seeded.close();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.close();
  });

  /** Runs `proposals …args --json`; its parsed stdout, failing on any stderr. */
  const proposals = async (...args: ReadonlyArray<string>) => {
    const child = Bun.spawn(
      ["bun", "run", "--silent", "proposals", ...args, "--json"],
      {
        cwd: core,
        env: { ...process.env, DATABASE_URL: cliUrl },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr.replace(/^.*allthings\.dev.*\n?/gm, "")).toBe("");
    expect(code).toBe(0);
    return JSON.parse(stdout) as Record<string, unknown>;
  };

  const sent = [
    "--title",
    "Effect in production",
    "--abstract",
    "What a year of Effect in a payments service taught us about errors.",
    "--name",
    "Ada Lovelace",
    "--email",
    "ada@example.com",
  ];

  describe("bun run proposals, on Postgres", () => {
    test("records one without links and one with, lists them, and removes one exactly as approved", async () => {
      const bare = (await proposals("add", ...sent)) as {
        proposal: { id: string; links: Array<string> };
      };
      expect(bare.proposal.links).toEqual([]);
      const linked = (await proposals(
        "add",
        ...sent,
        "--title",
        "With links",
        "--link",
        "https://github.com/ada",
        "--link",
        "https://ada.example",
      )) as { proposal: { links: Array<string> } };
      expect(linked.proposal.links).toEqual([
        "https://github.com/ada",
        "https://ada.example",
      ]);
      const listed = (await proposals("list")) as unknown as Array<{
        id: string;
      }>;
      expect(listed).toHaveLength(2);
      const { token } = (await proposals(
        "remove",
        bare.proposal.id,
        "--dry-run",
      )) as { token: string };
      await proposals("remove", bare.proposal.id, "--approve", token);
      expect(
        (await proposals("list")) as unknown as Array<unknown>,
      ).toHaveLength(1);
    });

    test("submitProposal sends links, and none, through the driver", async () => {
      const read = (links: ReadonlyArray<string>) => {
        const result = readProposal({
          title: `Intake ${links.length}`,
          abstract:
            "What a year of Effect in a payments service taught us about errors.",
          name: "Grace Hopper",
          email: "grace@example.com",
          links,
        });
        if (!result.ok) throw new Error(JSON.stringify(result.problems));
        return result.proposal;
      };
      for (const links of [[], ["https://grace.example"]]) {
        await Effect.runPromise(
          submitProposal(read(links), "api").pipe(
            Effect.provide(PgClient.layer({ url: Redacted.make(databaseUrl) })),
          ),
        );
      }
      const rows = (await seeded`
        SELECT title, links FROM planning.proposals
        WHERE title LIKE 'Intake %' ORDER BY title`) as Array<{
        title: string;
        links: Array<string>;
      }>;
      expect(rows).toEqual([
        { title: "Intake 0", links: [] },
        { title: "Intake 1", links: ["https://grace.example"] },
      ]);
    });
  });
}
