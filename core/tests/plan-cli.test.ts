import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import * as Migrations from "../src/migrator.ts";
import { readSeed } from "./support/database.ts";

/**
 * `bun run plan` (scripts/plan.ts) end to end, as the admin MCP server's
 * planning tools run it: flags in, JSON out, against a real Postgres. The
 * service itself is tested in planning.test.ts.
 *
 * Needs `CORE_TEST_POSTGRES_URL`, as tests/postgres.test.ts does; the test
 * makes its own database there and drops it afterwards.
 */

const serverUrl = process.env["CORE_TEST_POSTGRES_URL"];
const core = new URL("../", import.meta.url).pathname;

if (serverUrl === undefined) {
  test.skip("bun run plan (set CORE_TEST_POSTGRES_URL)", () => {});
} else {
  const admin = new SQL(serverUrl);
  const database = `allthings_core_test_${process.pid}_plan`;
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
  await seeded.close();
  afterAll(async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.close();
  });

  /** Runs `plan …args`; its exit code, stdout and stderr. */
  const plan = async (...args: ReadonlyArray<string>) => {
    const child = Bun.spawn(["bun", "run", "--silent", "plan", ...args], {
      cwd: core,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stdout, stderr };
  };

  const json = async (...args: ReadonlyArray<string>): Promise<unknown> => {
    const end = args.indexOf("--");
    const result = await plan(
      ...(end === -1
        ? [...args, "--json"]
        : [...args.slice(0, end), "--json", ...args.slice(end)]),
    );
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout) as unknown;
  };

  describe("bun run plan", () => {
    test("a dry run prints the write and keeps nothing", async () => {
      const dry = (await json(
        "idea",
        "add",
        "--title",
        "Made-up dry run",
        "--pitch",
        "Nothing kept.",
        "--program",
        "social",
        "--dry-run",
      )) as { id: string };
      expect(dry).toMatchObject({ title: "Made-up dry run", status: "idea" });
      const text = await plan(
        "idea",
        "add",
        "--title",
        "Made-up dry run",
        "--pitch",
        "Nothing kept.",
        "--program",
        "social",
        "--dry-run",
      );
      expect(text.stdout).toContain("Dry run: rolled back, nothing was kept.");
      const listed = (await json("idea", "list")) as Array<{ title: string }>;
      expect(listed.map((idea) => idea.title)).not.toContain("Made-up dry run");
    });

    test("sets and shows a draft's private lineup", async () => {
      expect(
        await json(
          "lineup",
          "set",
          "--mc",
          "Ada Lovelace",
          "--organizer",
          "Grace Hopper",
          "--",
          "2026-09-01-draft-night",
        ),
      ).toMatchObject([
        { role: "organizer", name: "Grace Hopper" },
        { role: "mc", name: "Ada Lovelace" },
      ]);
      const shown = await plan("lineup", "show", "2026-09-01-draft-night");
      expect(shown.stdout).toContain("mc: Ada Lovelace");
    });

    test("adds, updates and lists an idea", async () => {
      const added = (await json(
        "idea",
        "add",
        "--title",
        "Made-up quiz night",
        "--pitch",
        "Rounds on everything.",
        "--program",
        "social",
        "--topic",
        "quiz",
        "--inspired-by",
        "2026-08-12-react-at-acme",
      )) as { id: string };
      expect(added).toMatchObject({
        title: "Made-up quiz night",
        status: "idea",
        inspiredBy: { slug: "2026-08-12-react-at-acme" },
      });
      expect(
        await json(
          "idea",
          "update",
          "--status",
          "drafting",
          "--event",
          "2026-09-01-draft-night",
          "--clear-topic",
          "--",
          added.id,
        ),
      ).toMatchObject({
        status: "drafting",
        topic: null,
        event: { slug: "2026-09-01-draft-night", isDraft: true },
      });
      expect(await json("idea", "list", "--status", "drafting")).toMatchObject([
        { id: added.id },
      ]);
      const text = await plan("idea", "list");
      expect(text.stdout).toContain(
        `Made-up quiz night [drafting] ${added.id}`,
      );
    });

    test("adds a wanted speaker with a window, and finds them", async () => {
      expect(
        await json(
          "speaker",
          "add",
          "--profile",
          "Ada Lovelace",
          "--topic",
          "compilers",
          "--topic",
          "effect",
          "--window",
          '{"startsOn":"2027-01-01","note":"free after Dec"}',
        ),
      ).toMatchObject({
        person: { kind: "profile", name: "Ada Lovelace" },
        topics: ["compilers", "effect"],
        availability: [{ startsOn: "2027-01-01", note: "free after Dec" }],
      });
      expect(
        await json("speaker", "list", "--available-on", "2027-02-01"),
      ).toHaveLength(1);
      expect(
        await json("speaker", "list", "--available-on", "2026-12-01"),
      ).toEqual([]);
      expect(await json("search", "free after")).toMatchObject([
        { kind: "wanted speaker", label: "Ada Lovelace" },
      ]);
    });

    test("adds a host prospect and a note", async () => {
      expect(
        await json(
          "host",
          "add",
          "--sponsor",
          "Globex",
          "--contact-name",
          "Made-up Contact",
        ),
      ).toMatchObject({
        company: { kind: "host", name: "Globex" },
        contact: { name: "Made-up Contact", company: "Globex" },
        timesHosted: 1,
      });
      expect(
        await json("note", "add", "--sponsor", "Globex", "--body", "Made up."),
      ).toMatchObject({ about: "Globex", body: "Made up." });
      expect(
        await json("note", "add", "--sponsor=Globex", "--body=--made up"),
      ).toMatchObject({ body: "--made up" });
    });

    test("refuses, saying why, and writes nothing", async () => {
      const bad = await plan(
        "idea",
        "add",
        "--title",
        "Bad topic",
        "--pitch",
        "Nope.",
        "--program",
        "social",
        "--topic",
        "Not A Topic",
      );
      expect(bad.code).not.toBe(0);
      expect(bad.stderr).toContain('"Not A Topic" is not a topic');
      const both = await plan(
        "speaker",
        "add",
        "--profile",
        "Ada Lovelace",
        "--name",
        "Someone",
        "--topic",
        "ai",
      );
      expect(both.code).not.toBe(0);
      expect(both.stderr).toContain("Name one person");
    });

    test("audits planning's privacy", async () => {
      expect(await json("audit")).toMatchObject({ exposures: [] });
    });

    // Last: the wanted speaker it adds stays, and the tests above count them.
    test("adds, lists and removes a draft's private talk", async () => {
      const grace = (await json(
        "speaker",
        "add",
        "--profile",
        "Grace Hopper",
        "--topic",
        "postgres",
      )) as { id: string };
      const added = (await json(
        "lineup",
        "talk",
        "add",
        "--kind",
        "panel",
        "--title",
        "Made-up panel",
        "--moderator",
        grace.id,
        "--",
        "2026-09-01-draft-night",
      )) as Array<{ id: string }>;
      expect(added).toMatchObject([
        {
          position: 1,
          kind: "panel",
          title: "Made-up panel",
          people: [
            { role: "moderator", name: "Grace Hopper", status: "wanted" },
          ],
        },
      ]);
      const listed = await plan(
        "lineup",
        "talk",
        "list",
        "2026-09-01-draft-night",
      );
      expect(listed.stdout).toContain("1. panel: Made-up panel");
      expect(listed.stdout).toContain("moderator: Grace Hopper [wanted]");
      expect(
        await json(
          "lineup",
          "talk",
          "remove",
          "--",
          "2026-09-01-draft-night",
          added[0]?.id ?? "",
        ),
      ).toEqual([]);
    });
  });
}
