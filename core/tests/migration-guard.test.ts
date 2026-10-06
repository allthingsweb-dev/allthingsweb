import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  provisionLoginRole,
  type Statements,
} from "../../infra/scripts/login-role.ts";
import {
  grantStatements,
  SITE_READER,
} from "../../infra/scripts/site-reader.ts";
import {
  checkMigrations,
  fileOf,
  type MigrationRef,
  migrationOfPath,
} from "../src/migration-guard.ts";
import { migratedDatabase } from "./support/database.ts";

/**
 * The migration guard: a branch extends production's applied migrations,
 * and a pull request's new ones take numbers nobody else has, or the guard
 * says what to renumber, and to what.
 */

const m = (id: number, name: string): MigrationRef => ({ id, name });
const upTo10 = Array.from({ length: 10 }, (_, i) => m(i + 1, `step_${i + 1}`));

describe("checkMigrations", () => {
  test("a pull request adding the next number, and main as production has it, pass", () => {
    const applied = [...upTo10, m(11, "event_description")];
    expect(
      checkMigrations({
        local: [...applied, m(12, "planning")],
        applied,
        added: [m(12, "planning")],
        claims: [],
      }),
    ).toEqual([]);
    expect(
      checkMigrations({ local: applied, applied, added: [], claims: [] }),
    ).toEqual([]);
  });

  test("today's collision: production applied 0011 first, so the pull request's 0011 moves", () => {
    expect(
      checkMigrations({
        local: [...upTo10, m(11, "planning")],
        applied: [...upTo10, m(11, "event_description")],
        added: [m(11, "planning")],
        claims: [],
      }),
    ).toEqual([
      "Production has applied 0011_event_description, where this pull request has 0011_planning: merge main, then renumber 0011_planning to 0012_planning (core/migrations/0011_planning.ts, its key in core/migrations/index.ts, and its drizzle twin in app/migrations).",
    ]);
  });

  test("every migration the pull request adds from the collision on moves, past every number taken", () => {
    const [problem] = checkMigrations({
      local: [...upTo10, m(11, "a"), m(12, "b")],
      applied: [...upTo10, m(11, "event_description")],
      added: [m(11, "a"), m(12, "b")],
      // Another open pull request has 0012 and 0013 already.
      claims: [
        { pr: 150, ...m(12, "other") },
        { pr: 150, ...m(13, "more") },
      ],
    });
    expect(problem).toContain("renumber 0011_a to 0014_a");
    expect(problem).toContain("renumber 0012_b to 0015_b");
  });

  test("a branch behind production merges main", () => {
    expect(
      checkMigrations({
        local: upTo10,
        applied: [...upTo10, m(11, "event_description")],
        added: [],
        claims: [],
      }),
    ).toEqual([
      "Production has applied 0011_event_description, which this branch doesn't have: merge main, which has them.",
    ]);
  });

  test("an applied migration changed on the branch is put back", () => {
    expect(
      checkMigrations({
        local: [...upTo10, m(11, "renamed")],
        applied: [...upTo10, m(11, "event_description")],
        added: [],
        claims: [],
      })[0],
    ).toContain(
      "applied migrations are never renamed, reordered or removed; merge main, or put 0011_renamed back as 0011_event_description",
    );
  });

  test("two open pull requests taking one number: this one moves to the next free number", () => {
    expect(
      checkMigrations({
        local: [...upTo10, m(11, "mine")],
        applied: upTo10,
        added: [m(11, "mine")],
        claims: [{ pr: 153, ...m(11, "theirs") }],
      }),
    ).toEqual([
      "0011_mine takes 0011, as #153's 0011_theirs does: renumber 0011_mine to 0012_mine (core/migrations/0011_mine.ts, its key in core/migrations/index.ts, and its drizzle twin in app/migrations), or agree that the other pull request moves instead.",
    ]);
  });

  test("the same migration in another pull request is no rival", () => {
    expect(
      checkMigrations({
        local: [...upTo10, m(11, "same")],
        applied: upTo10,
        added: [m(11, "same")],
        claims: [{ pr: 153, ...m(11, "same") }],
      }),
    ).toEqual([]);
  });
});

describe("migrationOfPath", () => {
  test("reads core migration files, and nothing else", () => {
    expect(migrationOfPath("core/migrations/0019_x_user_ids.ts")).toEqual(
      m(19, "x_user_ids"),
    );
    expect(migrationOfPath("core/migrations/index.ts")).toBeNull();
    expect(migrationOfPath("app/migrations/0031_x_user_ids.sql")).toBeNull();
    expect(fileOf(m(7, "host_links"))).toBe("0007_host_links");
  });
});

const opened: Array<PGlite> = [];
afterAll(() => Promise.all(opened.map((db) => db.close())));

describe("site_reader and the record", () => {
  test("may read the applied migrations, and never write them", async () => {
    const db = await migratedDatabase();
    opened.push(db);
    const owner: Statements = {
      unsafe: async (query, values) =>
        (await db.query(query, values === undefined ? [] : [...values])).rows,
    };
    await provisionLoginRole(owner, SITE_READER, "test-only");
    for (const statement of grantStatements()) await db.exec(statement);
    await db.exec(`SET ROLE ${SITE_READER}`);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM effect_sql.migrations",
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
    const refused = await db.exec("DELETE FROM effect_sql.migrations").then(
      () => "deleted",
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    );
    expect(refused).toContain("permission denied");
  });
});
