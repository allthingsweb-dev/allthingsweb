import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Layer } from "effect";
import {
  expectedPrivileges,
  expectedSettings,
  PROPOSAL_INTAKE_ITEM,
} from "../../infra/scripts/proposal-intake.ts";
import {
  grantedQuery,
  STUDIO_PUBLIC_FUNCTIONS,
} from "../../infra/scripts/studio.ts";
import { vaultItems } from "../../infra/scripts/vault-items.ts";
import { sqlLayer as ownerLayer } from "../scripts/pglite.ts";
import { type IntakeSource, submitProposal } from "../src/proposal-intake.ts";
import { PROPOSAL_INTAKE } from "../src/proposal-intake-role.ts";
import { readProposal, recordProposal } from "../src/proposals.ts";
import { seededDatabase } from "./support/database.ts";

/**
 * proposal_intake (migrations/0040_proposals.ts), the role the site's
 * Worker sends proposals as, on a copy of production's schema:
 *
 * - its privileges are exactly INSERT of a proposal's columns, stated here
 *   once more rather than read from the migration, so widening the role
 *   takes changing both;
 * - every column of every table in `public` and `planning` is refused it,
 *   both ways, but those: no SELECT anywhere, not even of a proposal;
 * - it owns, executes and may change nothing more: no DDL, no role, no
 *   login until infra/scripts/proposal-intake.ts gives it one;
 * - submitProposal runs as it, and the table's trigger keeps a proposal
 *   sent twice once and stops a day's flood, as the owner.
 */

const inserts = [
  "title",
  "abstract",
  "format",
  "name",
  "email",
  "about",
  "links",
  "notes",
  "source",
];
const privileges = [
  "schema planning usage",
  ...inserts.map((column) => `planning.proposals insert ${column}`),
].toSorted();

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

/** Runs each statement as the role, in one transaction rolled back: each one's refusal, or undefined. */
async function asIntake(
  statements: ReadonlyArray<string>,
): Promise<ReadonlyArray<string | undefined>> {
  const outcomes: Array<string | undefined> = [];
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${PROPOSAL_INTAKE}`);
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
  test("are exactly INSERT of a proposal's columns", async () => {
    const { rows } = await db.query<{ grant: string }>(grantedQuery, [
      PROPOSAL_INTAKE,
    ]);
    expect(rows.map((row) => row.grant)).toEqual(privileges);
    // And infra/scripts/proposal-intake.ts checks for the same before it
    // gives the role a login.
    expect(expectedPrivileges()).toEqual(privileges);
  });

  test("execute only the harmless functions PUBLIC may, not the trigger's", async () => {
    const { rows } = await db.query<{ signature: string }>(
      `SELECT n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS signature
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND has_function_privilege($1, p.oid, 'EXECUTE')
       ORDER BY 1`,
      [PROPOSAL_INTAKE],
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
      [PROPOSAL_INTAKE],
    );
    expect(rows).toEqual([]);
    const attributes = await db.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
       FROM pg_roles WHERE rolname = $1`,
      [PROPOSAL_INTAKE],
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

  test("bound every session tightly", async () => {
    const { rows } = await db.query<{ setting: string }>(
      `SELECT unnest(setconfig) AS setting FROM pg_db_role_setting s
       JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1 ORDER BY 1`,
      [PROPOSAL_INTAKE],
    );
    expect(rows.map((row) => row.setting)).toEqual([
      "idle_in_transaction_session_timeout=5s",
      "lock_timeout=2s",
      "statement_timeout=5s",
    ]);
    expect(expectedSettings()).toEqual(rows.map((row) => row.setting));
  });
});

describe("every column of public and planning", () => {
  test("is refused it, but a proposal's columns to INSERT", async () => {
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
      const proposals = table === "planning.proposals";
      for (const column of columns) {
        attempts.push(
          {
            what: `${table} select ${column}`,
            statement: `SELECT "${column}" FROM ${quoted(table)} WHERE false`,
            may: false,
          },
          {
            what: `${table} insert ${column}`,
            statement: `INSERT INTO ${quoted(table)} ("${column}") SELECT NULL WHERE false`,
            may: proposals && inserts.includes(column),
          },
          {
            what: `${table} update ${column}`,
            statement: `UPDATE ${quoted(table)} SET "${column}" = NULL WHERE false`,
            may: false,
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
    expect(tables.some(({ table }) => table === "planning.proposals")).toBe(
      true,
    );
    const outcomes = await asIntake(attempts.map((a) => a.statement));
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
  test("no DDL, no role, no login, no reading back, no posing as an organizer", async () => {
    const attempts = [
      `CREATE TABLE planning.mine (id int)`,
      `ALTER TABLE planning.proposals ADD COLUMN mine int`,
      `DROP TABLE planning.proposals`,
      `CREATE ROLE mine`,
      `ALTER ROLE ${PROPOSAL_INTAKE} LOGIN`,
      `SELECT * FROM effect_sql.migrations`,
      `SELECT planning.proposals_intake()`,
      // What it adds, it can't read back.
      `INSERT INTO planning.proposals (title, abstract, name, email, source)
         VALUES ('T', 'An abstract long enough to read, at forty characters.', 'Ada', 'ada@example.com', 'site') RETURNING id`,
      // An organizer is named, and it may not name one.
      `INSERT INTO planning.proposals (title, abstract, name, email, source, recorded_by)
         VALUES ('T', 'An abstract long enough to read, at forty characters.', 'Ada', 'ada@example.com', 'organizer', 'erik')`,
    ];
    const outcomes = await asIntake(attempts);
    expect(
      attempts.filter((_, index) => outcomes[index] === undefined),
    ).toEqual([]);
    for (const outcome of outcomes) {
      expect(outcome).toMatch(/permission denied|must be|not permitted/);
    }
    // Without a name, an organizer's is refused by the table.
    const [unnamed] = await asIntake([
      `INSERT INTO planning.proposals (title, abstract, name, email, source)
         VALUES ('T', 'An abstract long enough to read, at forty characters.', 'Ada', 'ada@example.com', 'organizer')`,
    ]);
    expect(unnamed).toContain("proposals_organizer_check");
  });

  test("its credential is an item the vault list names", async () => {
    const item = (await vaultItems()).items.find(
      (listed) => listed.title === PROPOSAL_INTAKE_ITEM,
    );
    expect(item?.fields).toEqual(["credential"]);
  });
});

describe("submitProposal, as the role", () => {
  /** SqlClient over `db` as the role while its scope is open, the owner's again after. */
  const asRole = () =>
    ownerLayer(db).pipe(
      Layer.provideMerge(
        Layer.effectDiscard(
          Effect.acquireRelease(
            Effect.promise(() => db.exec(`SET ROLE ${PROPOSAL_INTAKE}`)),
            () => Effect.promise(() => db.exec("RESET ROLE")),
          ),
        ),
      ),
    );

  const read = (fields: Record<string, unknown> = {}) => {
    const result = readProposal({
      title: "Effect in production",
      abstract:
        "What a year of Effect in a payments service taught us about errors.",
      name: "Ada Lovelace",
      email: "ada@example.com",
      links: ["https://github.com/ada"],
      notes: "Free most Thursdays.",
      ...fields,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.proposal;
  };

  const submit = (
    fields?: Record<string, unknown>,
    source: IntakeSource = "site",
  ) =>
    Effect.runPromise(
      submitProposal(read(fields), source).pipe(
        Effect.provide(asRole()),
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => "kept",
        }),
      ),
    );

  const stored = async () =>
    (
      await db.query<Record<string, unknown>>(
        `SELECT title, format, email, links, notes, source, status, recorded_by
         FROM planning.proposals ORDER BY created_at, title`,
      )
    ).rows;

  test("keeps a proposal as sent, new, from its source", async () => {
    expect(await submit()).toBe("kept");
    expect(await submit({ title: "PGlite", format: "demo" }, "mcp")).toBe(
      "kept",
    );
    expect(await stored()).toEqual([
      {
        title: "Effect in production",
        format: "talk",
        email: "ada@example.com",
        links: ["https://github.com/ada"],
        notes: "Free most Thursdays.",
        source: "site",
        status: "new",
        recorded_by: null,
      },
      {
        title: "PGlite",
        format: "demo",
        email: "ada@example.com",
        links: ["https://github.com/ada"],
        notes: "Free most Thursdays.",
        source: "mcp",
        status: "new",
        recorded_by: null,
      },
    ]);
  });

  test("keeps the same proposal sent twice once, and says nothing different", async () => {
    expect(await submit()).toBe("kept");
    expect(await submit({ email: "ADA@example.com" })).toBe("kept");
    expect(await stored()).toHaveLength(1);
    // Once it is decided, the same words are a new proposal.
    await db.exec(
      `UPDATE planning.proposals SET status = 'declined', decided_at = now(), decided_by = 'erik'`,
    );
    expect(await submit()).toBe("kept");
    expect(await stored()).toHaveLength(2);
  });

  test("stops at 100 a day from outside, but not an organizer's", async () => {
    await db.exec(`
      INSERT INTO planning.proposals (title, abstract, name, email, source)
      SELECT 'Talk ' || n, 'An abstract long enough to read, at forty characters.', 'Someone', 'someone' || n || '@example.com', 'site'
      FROM generate_series(1, 99) AS n`);
    expect(await submit()).toBe("kept");
    expect(await submit({ title: "One more" })).toBe("ProposalIntakeFull");
    expect(await stored()).toHaveLength(100);
    // A day later, there is room again.
    await db.exec(
      `UPDATE planning.proposals SET created_at = created_at - interval '1 day 1 minute'`,
    );
    expect(await submit({ title: "One more" })).toBe("kept");
    // An organizer recording one sent to them is never stopped.
    await db.exec(
      `UPDATE planning.proposals SET created_at = now() WHERE title LIKE 'Talk %'`,
    );
    const recorded = await Effect.runPromise(
      recordProposal({
        title: "Sent by email",
        abstract: "An abstract long enough to be read in full.",
        name: "Grace Hopper",
        email: "grace@example.com",
      }).pipe(Effect.provide(ownerLayer(db))),
    );
    expect(recorded.source).toBe("organizer");
  });
});
