import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgClient } from "@effect/sql-pg";
import * as Migrations from "../src/migrator.ts";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Layer, Redacted } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { SITE_TABLES } from "../../infra/scripts/site-reader.ts";
import {
  expectedPrivileges,
  grantedQuery,
  OWNER_ONLY,
  STUDIO,
  STUDIO_COMMANDS,
  STUDIO_GRANTS,
  STUDIO_FUNCTIONS,
  STUDIO_PUBLIC_FUNCTIONS,
  STUDIO_SETTINGS,
} from "../../infra/scripts/studio.ts";
import { sqlLayer as ownerLayer } from "../scripts/pglite.ts";
import { Collab, collabTables, everyRow } from "../src/collab/collab.ts";
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

/** Runs one statement as the studio, rolled back: its refusal, or undefined. */
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

/** `schema.table` as a quoted SQL identifier. */
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
    // And the script's own check after --apply reads it the same way.
    expect(expectedPrivileges()).toEqual(expected);
    const read = await db.query<{ grant: string }>(grantedQuery, [STUDIO]);
    expect(read.rows.map((row) => row.grant)).toEqual(expected);
  });

  test("execute only the functions granted it, and the harmless ones PUBLIC may", async () => {
    const { rows } = await db.query<{ signature: string; definer: boolean }>(
      `SELECT n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS signature,
         p.prosecdef AS definer
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND has_function_privilege($1, p.oid, 'EXECUTE')
       ORDER BY 1`,
      [STUDIO],
    );
    // PUBLIC's are never SECURITY DEFINER; the one granted counts rows as
    // their owner, and only that.
    expect(rows).toEqual(
      [
        ...STUDIO_PUBLIC_FUNCTIONS.map((signature) => ({
          signature,
          definer: false,
        })),
        ...STUDIO_FUNCTIONS.map((signature) => ({ signature, definer: true })),
      ].toSorted((a, b) => (a.signature < b.signature ? -1 : 1)),
    );
  });

  test("own nothing, and belong to no role", async () => {
    const { rows } = await db.query<{ what: string }>(
      `SELECT 'owns ' || c.relname AS what FROM pg_catalog.pg_class c WHERE c.relowner = $1::regrole
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

  test("reads every collaboration table, each with row security and the studio's own policy", async () => {
    const { rows } = await db.query<{ name: string; policies: Array<string> }>(
      `SELECT c.relname AS name,
         COALESCE((SELECT array_agg(p.polname || ' ' || p.polcmd::text || ' ' || p.polpermissive::text
             || ' ' || pg_catalog.pg_get_expr(p.polqual, p.polrelid)
             || ' ' || pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) ORDER BY p.polname)
           FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid AND $1::regrole = ANY (p.polroles)), '{}') AS policies
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'planning' AND c.relrowsecurity ORDER BY 1`,
      [STUDIO],
    );
    // A new table with row security is a decision for collab and this role.
    expect(rows).toEqual(
      [...collabTables].toSorted().map((name) => ({
        name,
        policies: [`${name}_studio * true true true`],
      })),
    );
    for (const table of collabTables) {
      expect(STUDIO_GRANTS[`planning.${table}`]?.select).toBe(true);
    }
  });

  test("counts, as their owner, exactly the tables collab checks", async () => {
    // The migration keeps its own list, frozen; this holds the code's to it.
    const { rows } = await db.query<{ relname: string }>(
      `SELECT relname FROM planning.collab_row_counts() ORDER BY 1`,
    );
    expect(rows.map((row) => row.relname)).toEqual(
      [...collabTables].toSorted(),
    );
  });

  test("says why each thing it leaves to the owner is the owner's", () => {
    expect(OWNER_ONLY.map((entry) => entry.what)).toHaveLength(2);
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
  /**
   * A role that may read the collaboration's tables and count them as
   * their owner, but that row security holds back: the rows a signed-in
   * collaborator may see, here none.
   */
  const heldBack = async () => {
    await db.exec(`
      DO $made$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'held_back') THEN
          CREATE ROLE held_back NOLOGIN;
        END IF;
      END $made$;
      GRANT USAGE ON SCHEMA public, planning TO held_back;
      GRANT SELECT ON ALL TABLES IN SCHEMA public, planning TO held_back;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA planning TO held_back;
    `);
    return Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.promise(() => db.exec("SET ROLE held_back")),
        () => Effect.promise(() => db.exec("RESET ROLE")),
      ),
    ).pipe(Layer.provideMerge(ownerLayer(db)));
  };

  test("readiness reads it as the studio, and leaves it out, saying so, as a role held back", async () => {
    const report = Readiness.use((r) =>
      r.report({ _tag: "Event", slug: draft }),
    );
    const studio = await run(report, "studio");
    if (!Exit.isSuccess(studio)) throw new Error("the report failed");
    expect(studio.value.collaboration).toBe("read");
    expect(studio.value.checks.map((check) => check.kind)).toContain(
      "round-host",
    );
    const held = await Effect.runPromise(
      report.pipe(
        Effect.provide(
          Readiness.layer.pipe(
            Layer.provideMerge(Planning.layer),
            Layer.provideMerge(await heldBack()),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    expect(held.collaboration).toBe("not readable as this role");
    expect(held.checks.map((check) => check.kind)).not.toContain("round-host");
  });

  test("collab runs as the studio, and refuses a role held back, rather than read it short", async () => {
    expect(Exit.isSuccess(await run(everyRow, "studio"))).toBe(true);
    const held = await Effect.runPromiseExit(
      everyRow.pipe(Effect.provide(await heldBack())),
    );
    if (Exit.isSuccess(held)) throw new Error("expected a refusal");
    expect(String(Cause.squash(held.cause))).toContain(
      "row security hides some",
    );
  });

  test("access sync's emails are refused unless every collaborator shows", async () => {
    await db.exec(`
      INSERT INTO planning.collaborators (event_id, email, name, role, expires_at)
      VALUES ('${draftId}', 'made-up@example.com', 'Made Up', 'viewer', now() + interval '60 days')`);
    const emails = Collab.use((collab) => collab.activeEmails);
    const studio = await Effect.runPromise(
      emails.pipe(
        Effect.provide(
          Collab.layer.pipe(
            Layer.provideMerge(studioLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    expect(studio).toEqual(["made-up@example.com"]);
    const held = await Effect.runPromiseExit(
      emails.pipe(
        Effect.provide(
          Collab.layer.pipe(
            Layer.provideMerge(await heldBack()),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    if (Exit.isSuccess(held)) throw new Error("expected a refusal");
    expect(String(Cause.squash(held.cause))).toContain(
      "Access's list was left as it is",
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
  "luma registration": ["luma-registration.test.ts"],
  "luma hosts": ["luma-hosts.test.ts"],
  "luma:drafts --add": ["luma-drafts.test.ts"],
  "social bluesky": ["social-bluesky.test.ts"],
  "social discord": ["social-discord.test.ts"],
  "social x": ["social-x.test.ts"],
  posts: ["posts.test.ts", "post-candidates.test.ts"],
  photos: ["photos.test.ts"],
  "people photo": ["profile-photo.test.ts"],
  "hosts logo": ["host-logos.test.ts"],
  talks: ["talk-edits.test.ts"],
  "collab !end-sessions": [
    "collab.test.ts",
    "collab-cli.test.ts",
    "readiness-collab.test.ts",
  ],
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

/**
 * The script itself, on a disposable Postgres (CORE_TEST_POSTGRES_URL, as
 * tests/postgres.test.ts): its plan shows what would change and keeps
 * nothing, and it does nothing without --dry-run or --apply. --apply also
 * stores in 1Password, so it isn't run here; its check reads the catalog
 * with grantedQuery, held to the script's list above.
 */
const serverUrl = process.env["CORE_TEST_POSTGRES_URL"];
const repository = new URL("../../", import.meta.url).pathname;

if (serverUrl === undefined) {
  test.skip("infra/scripts/studio.ts (set CORE_TEST_POSTGRES_URL)", () => {});
} else {
  describe("infra/scripts/studio.ts", () => {
    const admin = new SQL(serverUrl);
    const database = `allthings_core_test_${process.pid}_studio`;
    const url = new URL(serverUrl);
    url.pathname = `/${database}`;

    beforeAll(async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${database}`);
      await Effect.runPromise(
        Migrations.run().pipe(
          Effect.provide(PgClient.layer({ url: Redacted.make(url.href) })),
        ),
      );
    });
    afterAll(async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.close();
    });

    /** Runs the script with `args`, as the owner of the disposable database. */
    const script = async (...args: ReadonlyArray<string>) => {
      const child = Bun.spawn(["bun", "infra/scripts/studio.ts", ...args], {
        cwd: repository,
        env: { ...process.env, OWNER_URL: url.href },
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

    /** What the role holds on the disposable database. */
    const held = async () => {
      const sql = new SQL(url.href);
      try {
        const rows: Array<{ n: number }> = await sql.unsafe(
          `SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE grantee = $1`,
          [STUDIO],
        );
        return rows[0]?.n;
      } finally {
        await sql.close();
      }
    };

    test("--dry-run shows every privilege it would grant, and keeps nothing", async () => {
      const result = await script("--dry-run");
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      for (const line of expectedPrivileges()) {
        expect(result.stdout).toContain(`+ ${line}`);
      }
      expect(result.stdout).toContain(
        'Its connection string would go to 1Password, "allthings studio" (credential) in allthings, and nowhere else.',
      );
      expect(result.stdout).toContain("Nothing was changed.");
      expect(await held()).toBe(0);
    }, 30_000);

    test("without --dry-run or --apply, it does nothing", async () => {
      const result = await script();
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Pass --dry-run");
      expect(await held()).toBe(0);
    });
  });
}
