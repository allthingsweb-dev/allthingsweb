import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgClient } from "@effect/sql-pg";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Layer, Redacted } from "effect";
import {
  expectedPrivileges,
  expectedSettings,
  PROFILE_EDITOR_ITEM,
} from "../../infra/scripts/profile-editor.ts";
import {
  grantedQuery,
  STUDIO_PUBLIC_FUNCTIONS,
} from "../../infra/scripts/studio.ts";
import { vaultItems } from "../../infra/scripts/vault-items.ts";
import { PROFILE_EDITOR } from "../src/profile-editor.ts";
import { sqlLayer as ownerLayer } from "../scripts/pglite.ts";
import * as Migrations from "../src/migrator.ts";
import type { Now } from "../src/now.ts";
import { applyPeople, type PeopleFile } from "../src/people-enrichment.ts";
import { clockLayer, seededDatabase } from "./support/database.ts";

/**
 * profile_editor (migrations/0034_profile_editor.ts), the role
 * `bun run people <file>` connects as, on a copy of production's schema:
 *
 * - its privileges are exactly these, stated here once more rather than
 *   read from the migration, so widening the role takes changing both;
 * - every column of every table in `public` and `planning` is read and
 *   changed only where they say, and nothing is added, deleted or
 *   truncated anywhere: tried, statement by statement, both ways;
 * - it owns, executes and may change nothing more: no DDL, no role, no
 *   login until infra/scripts/profile-editor.ts gives it one;
 * - applyPeople, the whole pipeline, runs as it: a dry run, then the file
 *   committed, with every kind of fact the file can carry.
 */

const reads = [
  "id",
  "name",
  "title",
  "bio",
  "twitter_handle",
  "bluesky_handle",
  "linkedin_handle",
  "photo_source_url",
  "image",
  "now_record",
];
const writes = [
  "title",
  "bio",
  "twitter_handle",
  "bluesky_handle",
  "linkedin_handle",
  "photo_source_url",
  "now_record",
  "updated_at",
];
const privileges = [
  "schema public usage",
  ...reads.map((column) => `public.profiles select ${column}`),
  ...writes.map((column) => `public.profiles update ${column}`),
].toSorted();

let db: PGlite;
beforeAll(async () => {
  db = await seededDatabase();
});
afterAll(() => db.close());

/** Runs each statement as the role, in one transaction rolled back: each one's refusal, or undefined. */
async function asEditor(
  statements: ReadonlyArray<string>,
): Promise<ReadonlyArray<string | undefined>> {
  const outcomes: Array<string | undefined> = [];
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${PROFILE_EDITOR}`);
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

/** `schema.table` as a quoted SQL identifier. */
const quoted = (table: string) =>
  table
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");

describe("its privileges in the catalog", () => {
  test("are exactly the profile columns the pipeline reads and writes", async () => {
    const { rows } = await db.query<{ grant: string }>(grantedQuery, [
      PROFILE_EDITOR,
    ]);
    expect(rows.map((row) => row.grant)).toEqual(privileges);
    // And infra/scripts/profile-editor.ts checks for the same before it
    // gives the role a login.
    expect(expectedPrivileges()).toEqual(privileges);
  });

  test("execute only the harmless functions PUBLIC may", async () => {
    const { rows } = await db.query<{ signature: string }>(
      `SELECT n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS signature
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND has_function_privilege($1, p.oid, 'EXECUTE')
       ORDER BY 1`,
      [PROFILE_EDITOR],
    );
    expect(rows.map((row) => row.signature)).toEqual(
      [...STUDIO_PUBLIC_FUNCTIONS].toSorted(),
    );
  });

  test("own nothing, belong to no role, and have no login yet", async () => {
    const { rows } = await db.query<{ what: string }>(
      `SELECT 'owns ' || c.relname AS what FROM pg_catalog.pg_class c WHERE c.relowner = $1::regrole
       UNION ALL
       SELECT 'owns schema ' || n.nspname FROM pg_catalog.pg_namespace n WHERE n.nspowner = $1::regrole
       UNION ALL
       SELECT 'owns ' || p.proname FROM pg_catalog.pg_proc p WHERE p.proowner = $1::regrole
       UNION ALL
       SELECT 'member of ' || g.rolname FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles g ON g.oid = m.roleid WHERE m.member = $1::regrole`,
      [PROFILE_EDITOR],
    );
    expect(rows).toEqual([]);
    const attributes = await db.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
       FROM pg_roles WHERE rolname = $1`,
      [PROFILE_EDITOR],
    );
    expect(attributes.rows).toEqual([
      {
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolinherit: false,
      },
    ]);
  });

  test("bound every session", async () => {
    const { rows } = await db.query<{ setting: string }>(
      `SELECT unnest(setconfig) AS setting FROM pg_db_role_setting s
       JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1 ORDER BY 1`,
      [PROFILE_EDITOR],
    );
    expect(rows.map((row) => row.setting)).toEqual([
      "idle_in_transaction_session_timeout=30s",
      "lock_timeout=5s",
      "statement_timeout=30s",
    ]);
    expect(expectedSettings()).toEqual(rows.map((row) => row.setting));
  });
});

describe("every column of public and planning", () => {
  test("is read and changed only where the grants say, and nothing is added or removed", async () => {
    const { rows: tables } = await db.query<{
      table: string;
      columns: Array<string>;
    }>(
      `SELECT n.nspname || '.' || c.relname AS "table",
         array_agg(a.attname::text ORDER BY a.attnum) FILTER (WHERE a.attgenerated = '') AS columns
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname IN ('public', 'planning') AND c.relkind IN ('r', 'p')
       GROUP BY 1 ORDER BY 1`,
    );
    const attempts: Array<{ what: string; statement: string; may: boolean }> =
      [];
    for (const { table, columns } of tables) {
      const profiles = table === "public.profiles";
      for (const column of columns) {
        attempts.push(
          {
            what: `${table} select ${column}`,
            statement: `SELECT "${column}" FROM ${quoted(table)} WHERE false`,
            may: profiles && reads.includes(column),
          },
          {
            what: `${table} insert ${column}`,
            statement: `INSERT INTO ${quoted(table)} ("${column}") SELECT NULL WHERE false`,
            may: false,
          },
          {
            what: `${table} update ${column}`,
            statement: `UPDATE ${quoted(table)} SET "${column}" = NULL WHERE false`,
            may: profiles && writes.includes(column),
          },
        );
      }
      attempts.push(
        {
          what: `${table} delete`,
          statement: `DELETE FROM ${quoted(table)} WHERE false`,
          may: false,
        },
        {
          what: `${table} truncate`,
          statement: `TRUNCATE ${quoted(table)}`,
          may: false,
        },
      );
    }
    expect(tables.some(({ table }) => table === "public.profiles")).toBe(true);
    const outcomes = await asEditor(attempts.map((a) => a.statement));
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
  }, 60_000);
});

describe("nothing else", () => {
  test("no DDL, no role, no login, no migration record", async () => {
    const attempts = [
      `CREATE TABLE public.mine (id int)`,
      `ALTER TABLE public.profiles ADD COLUMN mine int`,
      `ALTER TABLE public.profiles DROP COLUMN bio`,
      `DROP TABLE public.profiles`,
      `CREATE INDEX mine ON public.profiles (name)`,
      `CREATE SCHEMA mine`,
      `CREATE FUNCTION public.mine() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
      `CREATE ROLE mine`,
      `ALTER ROLE ${PROFILE_EDITOR} LOGIN`,
      `ALTER ROLE ${PROFILE_EDITOR} BYPASSRLS`,
      `SELECT * FROM effect_sql.migrations`,
      `SELECT planning.collab_row_counts()`,
    ];
    const outcomes = await asEditor(attempts);
    expect(
      attempts.filter((_, index) => outcomes[index] === undefined),
    ).toEqual([]);
    for (const outcome of outcomes) {
      expect(outcome).toMatch(/permission denied|must be|not permitted/);
    }
  });

  test("its credential is an item the vault list names", async () => {
    const item = (await vaultItems()).items.find(
      (listed) => listed.title === PROFILE_EDITOR_ITEM,
    );
    expect(item?.fields).toEqual(["credential"]);
  });
});

describe("bun run people, as the role", () => {
  const ada = "b0000000-0000-4000-8000-000000000001";
  const grace = "b0000000-0000-4000-8000-000000000002";
  const linus = "b0000000-0000-4000-8000-000000000003";
  const source = "https://example.com/about";
  const read = "2026-10-02";
  const now: Now = {
    line: "Grace [writes compilers](https://compilers.example/grace).",
    links: [
      {
        title: "On compilers",
        date: "2026-09-30",
        url: "https://compilers.example/grace/on-compilers",
        kind: "post",
      },
    ],
    checkedOn: "2026-10-02",
  };
  // Every kind of fact: blanks filled, a stale value replaced (`was`), a
  // handle changed (so the X counts' trigger runs), a photo source and a
  // "now" record, beside a filled value kept.
  const file: PeopleFile = [
    {
      profileId: grace,
      name: "Grace Hopper",
      bio: { value: "Grace Hopper wrote the first compiler.", source, read },
      twitterHandle: { value: "grace", source, read },
      blueskyHandle: { value: "grace.example.com", source, read },
      photoSourceUrl: {
        value: "https://avatars.githubusercontent.com/u/2",
        source,
        read,
      },
      now,
    },
    {
      profileId: linus,
      name: "Linus",
      title: { value: "Maintainer", source, read },
      twitterHandle: { value: "linus", source, read, was: "@linus" },
    },
    {
      profileId: ada,
      name: "Ada Lovelace",
      title: { value: "Mathematician", source, read },
      linkedinHandle: {
        value: "ada",
        source,
        read,
        was: "ada-lovelace",
      },
    },
  ];

  /** SqlClient over `db` as the role while its scope is open, the owner's again after. */
  const asRole = () =>
    ownerLayer(db).pipe(
      Layer.provideMerge(
        Layer.effectDiscard(
          Effect.acquireRelease(
            Effect.promise(() => db.exec(`SET ROLE ${PROFILE_EDITOR}`)),
            () => Effect.promise(() => db.exec("RESET ROLE")),
          ),
        ),
      ),
    );

  const apply = (dryRun: boolean) =>
    Effect.runPromiseExit(
      applyPeople(file, dryRun).pipe(
        Effect.provide(asRole()),
        Effect.provide(clockLayer),
      ),
    );

  const profiles = async () =>
    (
      await db.query<Record<string, unknown>>(
        `SELECT id::text, title, bio, twitter_handle, bluesky_handle, linkedin_handle,
           photo_source_url, now_record IS NOT NULL AS has_now
         FROM profiles WHERE id IN ('${ada}', '${grace}', '${linus}') ORDER BY id`,
      )
    ).rows;

  test("dry runs, writing nothing", async () => {
    const before = await profiles();
    const exit = await apply(true);
    expect(Exit.isSuccess(exit) ? exit.value.at(-1) : exit).toBe(
      "Dry run: rolled back.",
    );
    expect(await profiles()).toEqual(before);
  });

  test("and fills the file in", async () => {
    const exit = await apply(false);
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([
      expect.stringContaining("Grace Hopper: bio ←"),
      expect.stringContaining(
        'Linus: title ← Maintainer, twitter_handle "@linus" → linus',
      ),
      expect.stringContaining(
        'Ada Lovelace: title kept (already "Engineer"), linkedin_handle "ada-lovelace" → ada',
      ),
    ]);
    expect(await profiles()).toEqual([
      {
        id: ada,
        title: "Engineer",
        bio: "Writes compilers.",
        twitter_handle: "ada",
        bluesky_handle: "ada.bsky.social",
        linkedin_handle: "ada",
        photo_source_url: null,
        has_now: false,
      },
      {
        id: grace,
        title: "Admiral",
        bio: "Grace Hopper wrote the first compiler.",
        twitter_handle: "grace",
        bluesky_handle: "grace.example.com",
        linkedin_handle: "grace hopper",
        photo_source_url: "https://avatars.githubusercontent.com/u/2",
        has_now: true,
      },
      {
        id: linus,
        title: "Maintainer",
        bio: "Kernel.",
        twitter_handle: "linus",
        bluesky_handle: null,
        linkedin_handle: null,
        photo_source_url: null,
        has_now: false,
      },
    ]);
  });
});

/**
 * infra/scripts/profile-editor.ts on a real Postgres (CI's, or
 * CORE_TEST_POSTGRES_URL): on a migrated database its --dry-run shows the
 * migration's privileges and keeps nothing, it refuses a database the
 * migration hasn't reached, and it does nothing without --dry-run or
 * --apply. --apply also stores in 1Password, so it isn't run here; its
 * check is the --dry-run's.
 */
const serverUrl = process.env["CORE_TEST_POSTGRES_URL"];
const repository = new URL("../../", import.meta.url).pathname;

if (serverUrl === undefined) {
  test.skip("infra/scripts/profile-editor.ts (set CORE_TEST_POSTGRES_URL)", () => {});
} else {
  describe("infra/scripts/profile-editor.ts", () => {
    const admin = new SQL(serverUrl);
    const database = `allthings_core_test_${process.pid}_profile_editor`;
    const bare = `${database}_bare`;
    const urlOf = (name: string) => {
      const url = new URL(serverUrl);
      url.pathname = `/${name}`;
      return url.href;
    };

    beforeAll(async () => {
      for (const name of [database, bare]) {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.unsafe(`CREATE DATABASE ${name}`);
      }
      await Effect.runPromise(
        Migrations.run().pipe(
          Effect.provide(
            PgClient.layer({ url: Redacted.make(urlOf(database)) }),
          ),
        ),
      );
    });
    afterAll(async () => {
      for (const name of [database, bare]) {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      }
      await admin.close();
    });

    const script = async (url: string, ...args: ReadonlyArray<string>) => {
      const child = Bun.spawn(
        ["bun", "infra/scripts/profile-editor.ts", ...args],
        {
          cwd: repository,
          env: { ...process.env, OWNER_URL: url },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, stdout, stderr };
    };

    const canLogIn = async () => {
      const rows: Array<{ login: boolean }> = await admin.unsafe(
        `SELECT rolcanlogin AS login FROM pg_roles WHERE rolname = $1`,
        [PROFILE_EDITOR],
      );
      return rows[0]?.login;
    };

    test("--dry-run shows the migration's privileges, and keeps nothing", async () => {
      const before = await canLogIn();
      const result = await script(urlOf(database), "--dry-run");
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      for (const line of privileges)
        expect(result.stdout).toContain(`  ${line}`);
      expect(result.stdout).toContain(
        `Its connection string would go to 1Password, "${PROFILE_EDITOR_ITEM}" (credential) in allthings, and nowhere else.`,
      );
      expect(result.stdout).toContain("Nothing was changed.");
      expect(await canLogIn()).toBe(before);
    }, 30_000);

    test("refuses a database the migration hasn't granted", async () => {
      const result = await script(urlOf(bare), "--dry-run");
      expect(result.code).not.toBe(0);
      // The role is the server's, so another database's migration may have
      // made it; here it holds nothing, and the script says so.
      expect(result.stderr).toMatch(
        /run core's migrations first|privileges aren't migration 0034's/,
      );
    }, 30_000);

    test("without --dry-run or --apply, it does nothing", async () => {
      const result = await script(urlOf(database));
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Pass --dry-run");
    });
  });
}
