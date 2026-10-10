import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Layer } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { SITE_TABLES } from "../../infra/scripts/site-reader.ts";
import {
  OWNER_ONLY,
  STUDIO,
  STUDIO_COMMANDS,
  STUDIO_GRANTS,
  STUDIO_SETTINGS,
} from "../../infra/scripts/studio.ts";
import { sqlLayer as ownerLayer } from "../scripts/pglite.ts";
import { collabTables, ownerOnly } from "../src/collab/collab.ts";
import { Planning } from "../src/planning/planning.ts";
import { Readiness } from "../src/readiness/readiness.ts";
import {
  clockLayer,
  provisionStudio,
  seededDatabase,
  studioLayer,
} from "./support/database.ts";

/**
 * The studio role (infra/scripts/studio.ts), made and granted with the
 * script's own statements on a copy of production's schema:
 *
 * - every column of every table in `public` and `planning` may be read,
 *   added and changed exactly as the script says, every row deleted only
 *   where it says, and nothing anywhere else: tried, statement by
 *   statement, both ways;
 * - its privileges in the catalog are exactly the script's, and it owns,
 *   executes and may change nothing more: no DDL, no row security bypass;
 * - readiness and collab, which need every collaboration row, don't take
 *   the empty answer row security gives it for all well;
 * - every studio command has suites `bun run test:studio` runs as it, so
 *   what each command does, it may (package.json).
 */

let db: PGlite;
const draft = "2026-09-01-draft-night";
const draftId = "e0000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  db = await seededDatabase();
  // A round no one hosts yet: what readiness's collaboration advice is about.
  await db.exec(`
    UPDATE events SET start_date = now() + interval '30 days', end_date = now() + interval '30 days 3 hours'
      WHERE id = '${draftId}';
    INSERT INTO planning.rounds (event_id, position, title) VALUES ('${draftId}', 1, 'Made-up round');
  `);
  await provisionStudio(db);
});
afterAll(() => db.close());

/** Runs each statement as the studio, in one transaction rolled back: each one's refusal, or undefined. */
async function asStudio(
  statements: ReadonlyArray<string>,
): Promise<ReadonlyArray<string | undefined>> {
  const outcomes: Array<string | undefined> = [];
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${STUDIO}`);
    for (const statement of statements) {
      await db.exec("SAVEPOINT attempt");
      try {
        await db.exec(statement);
        outcomes.push(undefined);
      } catch (error) {
        outcomes.push(error instanceof Error ? error.message : String(error));
      }
      await db.exec("ROLLBACK TO SAVEPOINT attempt");
    }
  } finally {
    await db.exec("ROLLBACK");
  }
  return outcomes;
}

const refusalAs = async (statement: string) => (await asStudio([statement]))[0];

/** Every table in `public` and `planning`, with its columns (not generated ones: nothing writes those). */
const tables = async () => {
  const { rows } = await db.query<{ table: string; columns: Array<string> }>(
    `SELECT n.nspname || '.' || c.relname AS "table",
       array_agg(a.attname::text ORDER BY a.attnum) FILTER (WHERE a.attgenerated = '') AS columns
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname IN ('public', 'planning') AND c.relkind IN ('r', 'p')
     GROUP BY 1 ORDER BY 1`,
  );
  return rows;
};

const quoted = (table: string) =>
  table
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");

describe("every column of public and planning", () => {
  test("is read, added, changed and deleted exactly as the script says, and nothing else", async () => {
    const attempts: Array<{ what: string; statement: string; may: boolean }> =
      [];
    for (const { table, columns } of await tables()) {
      const grants = STUDIO_GRANTS[table] ?? {};
      for (const column of columns) {
        attempts.push(
          {
            what: `${table} select ${column}`,
            statement: `SELECT "${column}" FROM ${quoted(table)} WHERE false`,
            may: grants.select === true,
          },
          {
            what: `${table} insert ${column}`,
            statement: `INSERT INTO ${quoted(table)} ("${column}") SELECT NULL WHERE false`,
            may: grants.insert?.includes(column) === true,
          },
          {
            what: `${table} update ${column}`,
            statement: `UPDATE ${quoted(table)} SET "${column}" = NULL WHERE false`,
            may: grants.update?.includes(column) === true,
          },
        );
      }
      attempts.push(
        {
          what: `${table} delete`,
          statement: `DELETE FROM ${quoted(table)} WHERE false`,
          may: grants.delete === true,
        },
        {
          what: `${table} truncate`,
          statement: `TRUNCATE ${quoted(table)}`,
          may: false,
        },
      );
    }
    const outcomes = await asStudio(attempts.map((a) => a.statement));
    const wrong = attempts.flatMap((attempt, index) => {
      const refusal = outcomes[index];
      if (attempt.may && refusal !== undefined) {
        return [`${attempt.what}: refused (${refusal})`];
      }
      if (!attempt.may && !refusal?.startsWith("permission denied")) {
        return [`${attempt.what}: ${refusal ?? "allowed"}`];
      }
      return [];
    });
    expect(wrong).toEqual([]);
    // It tried every one of the script's grants.
    for (const table of Object.keys(STUDIO_GRANTS)) {
      expect(attempts.some((a) => a.what.startsWith(`${table} `))).toBe(true);
    }
  }, 60_000);
});

describe("its privileges in the catalog", () => {
  test("are exactly the script's: tables, columns and schemas", async () => {
    const granted = await db.query<{ grant: string }>(
      `SELECT n.nspname || '.' || c.relname || ' ' || lower(a.privilege_type) AS grant
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
       aclexplode(c.relacl) a
       WHERE a.grantee = $1::regrole
       UNION ALL
       SELECT n.nspname || '.' || c.relname || ' ' || lower(a.privilege_type) || ' ' || t.attname
       FROM pg_catalog.pg_attribute t
       JOIN pg_catalog.pg_class c ON c.oid = t.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
       aclexplode(t.attacl) a
       WHERE a.grantee = $1::regrole
       UNION ALL
       SELECT 'schema ' || n.nspname || ' ' || lower(a.privilege_type)
       FROM pg_catalog.pg_namespace n, aclexplode(n.nspacl) a
       WHERE a.grantee = $1::regrole
       ORDER BY 1`,
      [STUDIO],
    );
    const expected = [
      "schema planning usage",
      "schema public usage",
      ...Object.entries(STUDIO_GRANTS).flatMap(([table, grants]) => [
        ...(grants.select === true ? [`${table} select`] : []),
        ...(grants.delete === true ? [`${table} delete`] : []),
        ...(grants.insert ?? []).map((column) => `${table} insert ${column}`),
        ...(grants.update ?? []).map((column) => `${table} update ${column}`),
      ]),
    ].toSorted();
    expect(granted.rows.map((row) => row.grant)).toEqual(expected);
  });

  test("execute no function PUBLIC may not, own nothing, and belong to no role", async () => {
    const { rows } = await db.query<{ what: string }>(
      `SELECT 'executes ' || p.oid::regprocedure::text AS what
       FROM pg_catalog.pg_proc p
       WHERE has_function_privilege($1, p.oid, 'EXECUTE')
         AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
       UNION ALL
       SELECT 'owns ' || c.relname FROM pg_catalog.pg_class c WHERE c.relowner = $1::regrole
       UNION ALL
       SELECT 'owns schema ' || n.nspname FROM pg_catalog.pg_namespace n WHERE n.nspowner = $1::regrole
       UNION ALL
       SELECT 'owns ' || p.proname FROM pg_catalog.pg_proc p WHERE p.proowner = $1::regrole
       UNION ALL
       SELECT 'member of ' || g.rolname FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles g ON g.oid = m.roleid WHERE m.member = $1::regrole`,
      [STUDIO],
    );
    expect(rows).toEqual([]);
  });

  test("bound every session, and bypass no row security", async () => {
    const settings = await db.query<{ setting: string }>(
      `SELECT unnest(setconfig) AS setting FROM pg_db_role_setting s
       JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1 ORDER BY 1`,
      [STUDIO],
    );
    expect(settings.rows.map((row) => row.setting)).toEqual(
      Object.entries(STUDIO_SETTINGS)
        .map(([name, value]) => `${name}=${value}`)
        .toSorted(),
    );
    const attributes = await db.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
       FROM pg_roles WHERE rolname = $1`,
      [STUDIO],
    );
    expect(attributes.rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolinherit: false,
      },
    ]);
  });
});

describe("what the script grants", () => {
  test("reads on public only tables site_reader reads", () => {
    const beyond = Object.keys(STUDIO_GRANTS)
      .filter((table) => table.startsWith("public."))
      .filter(
        (table) =>
          !(SITE_TABLES as ReadonlyArray<string>).includes(
            table.slice("public.".length),
          ),
      );
    expect(beyond).toEqual([]);
  });

  test("names nothing of the collaboration, whose tables all have row security", async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'planning' AND c.relrowsecurity ORDER BY 1`,
    );
    // A new table with row security is a decision for collab and this role.
    expect(rows.map((row) => row.name)).toEqual([...collabTables].toSorted());
    expect(
      Object.keys(STUDIO_GRANTS).filter((table) =>
        (collabTables as ReadonlyArray<string>).includes(
          table.replace(/^planning\./, ""),
        ),
      ),
    ).toEqual([]);
  });

  test("says why each thing it leaves to the owner is the owner's", () => {
    expect(OWNER_ONLY.map((entry) => entry.what)).toHaveLength(3);
    for (const entry of OWNER_ONLY)
      expect(entry.why.length).toBeGreaterThan(40);
  });
});

describe("nothing for migrations", () => {
  test("no DDL, no role, no functions it isn't given", async () => {
    const attempts = [
      `CREATE TABLE public.mine (id int)`,
      `CREATE TABLE planning.mine (id int)`,
      `ALTER TABLE public.events ADD COLUMN mine int`,
      `ALTER TABLE planning.ideas DROP COLUMN pitch`,
      `ALTER TABLE planning.rounds DISABLE ROW LEVEL SECURITY`,
      `DROP TABLE planning.notes`,
      `CREATE INDEX mine ON public.events (name)`,
      `CREATE SCHEMA mine`,
      `CREATE FUNCTION public.mine() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
      `CREATE ROLE mine`,
      `ALTER ROLE ${STUDIO} BYPASSRLS`,
      `SELECT planning.collab_email()`,
      `SELECT * FROM planning.collab_roster('${draftId}')`,
      `SELECT * FROM effect_sql.migrations`,
    ];
    const outcomes = await asStudio(attempts);
    expect(
      attempts.filter((_, index) => outcomes[index] === undefined),
    ).toEqual([]);
    for (const outcome of outcomes) {
      expect(outcome).toMatch(/permission denied|must be|not permitted/);
    }
  });

  test("and no grant of its own to anyone", async () => {
    // Without the grant option, Postgres only warns; nothing changes.
    expect(
      await refusalAs(`GRANT SELECT ON planning.contacts TO PUBLIC`),
    ).toBeUndefined();
    const { rows } = await db.query<{ reads: boolean }>(
      `SELECT has_table_privilege('public', 'planning.contacts', 'SELECT') AS reads`,
    );
    expect(rows).toEqual([{ reads: false }]);
  });
});

/** Runs `effect` with a SqlClient as the studio, or as the owner. */
const run = <A, E>(
  effect: Effect.Effect<A, E, Readiness | SqlClient>,
  as: "studio" | "owner",
) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(
        Readiness.layer.pipe(
          Layer.provideMerge(Planning.layer),
          Layer.provideMerge(
            as === "studio" ? studioLayer(db) : ownerLayer(db),
          ),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  );

describe("what needs every collaboration row", () => {
  test("readiness, as the studio, leaves the collaboration's advice out and says so", async () => {
    const report = Readiness.use((r) =>
      r.report({ _tag: "Event", slug: draft }),
    );
    const owner = await run(report, "owner");
    const studio = await run(report, "studio");
    if (!Exit.isSuccess(owner) || !Exit.isSuccess(studio)) {
      throw new Error("the report failed");
    }
    expect(owner.value.collaboration).toBe("read");
    expect(owner.value.checks.map((check) => check.kind)).toContain(
      "round-host",
    );
    expect(studio.value.planning).toBe("read");
    expect(studio.value.collaboration).toBe("not readable as this role");
    expect(studio.value.checks.map((check) => check.kind)).not.toContain(
      "round-host",
    );
  });

  test("collab refuses to run as the studio, rather than read it empty", async () => {
    expect(Exit.isSuccess(await run(ownerOnly, "owner"))).toBe(true);
    const studio = await run(ownerOnly, "studio");
    if (Exit.isSuccess(studio)) throw new Error("expected a refusal");
    expect(String(Cause.squash(studio.cause))).toContain(
      "bun run collab runs as the database owner",
    );
  });
});

/**
 * Each studio command's suites: the tests of the code it runs, which
 * `bun run test:studio` runs as the role (tests/support/database.ts), each
 * a statement the command makes.
 */
const suites: Readonly<
  Record<(typeof STUDIO_COMMANDS)[number], ReadonlyArray<string>>
> = {
  plan: ["planning.test.ts", "planning-dry-run.test.ts", "plan-cli.test.ts"],
  readiness: ["readiness.test.ts"],
  "luma create": ["luma-studio.test.ts"],
  "luma update": ["luma-studio.test.ts", "promo.test.ts"],
  "luma publish": ["luma-studio.test.ts", "promo.test.ts"],
  "luma cover": ["luma-cover.test.ts"],
  "luma:drafts --add": ["luma-drafts.test.ts"],
  "social bluesky": ["social-bluesky.test.ts"],
  "social discord": ["social-discord.test.ts"],
  "social x": ["social-x.test.ts"],
  posts: ["posts.test.ts", "post-candidates.test.ts"],
  photos: ["photos.test.ts"],
  "people photo": ["profile-photo.test.ts"],
  "hosts logo": ["host-logos.test.ts"],
  talks: ["talk-edits.test.ts"],
};

describe("every studio command", () => {
  test("has suites test:studio runs as the role, and it runs no others", async () => {
    const pkg = (await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json()) as { scripts: Record<string, string> };
    const script = pkg.scripts["test:studio"] ?? "";
    expect(script.startsWith("CORE_TEST_AS=studio bun test ")).toBe(true);
    const listed = script
      .slice("CORE_TEST_AS=studio bun test ".length)
      .split(/\s+/)
      .map((path) => path.replace(/^tests\//, ""))
      .toSorted();
    expect(listed).toEqual(
      [...new Set(Object.values(suites).flat())].toSorted(),
    );
    for (const file of listed) {
      expect(await Bun.file(new URL(file, import.meta.url)).exists()).toBe(
        true,
      );
    }
  });
});
