import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  DRAFT_COLLAB,
  DRAFT_COLLAB_FUNCTIONS,
  DRAFT_COLLAB_GRANTS,
  DRAFT_COLLAB_SETTINGS,
  grantStatements,
} from "../../infra/scripts/draft-collab.ts";
import {
  provisionLoginRole,
  type Statements,
} from "../../infra/scripts/login-role.ts";
import { seededDatabase } from "./support/database.ts";

/**
 * draft_collab (infra/scripts/draft-collab.ts), made and granted with the
 * script's own statements on a copy of production's schema: what the draft
 * preview does as it succeeds, everything else is refused, and its
 * privileges in the catalog are exactly the script's. Which rows it sees is
 * the policies' (tests/draft-collaboration.test.ts); here, what it may
 * touch at all.
 */

const host = {
  id: "c4000000-0000-4000-8000-000000000001",
  email: "host@example.com",
};
const round = "c1000000-0000-4000-8000-000000000001";
const item = "c3000000-0000-4000-8000-000000000001";
const venue = {
  id: "c4000000-0000-4000-8000-000000000002",
  email: "venue@example.com",
};
const nonce = `'\\x000000000000000000000000'`;
const sealed = `'\\x0000000000000000000000000000000000'`;

let db: PGlite;
let event = "";

const owner = (database: PGlite): Statements => ({
  unsafe: async (query, values) =>
    (await database.query(query, values === undefined ? [] : [...values])).rows,
});

beforeAll(async () => {
  db = await seededDatabase();
  const [first] = (
    await db.query<{ id: string }>(`SELECT id FROM events ORDER BY id LIMIT 1`)
  ).rows;
  if (first === undefined) throw new Error("the seed has no events");
  event = first.id;
  await db.exec(`
    INSERT INTO planning.rounds (id, event_id, position, title) VALUES ('${round}', '${event}', 1, 'Round');
    INSERT INTO planning.collaborators (id, event_id, email, name, role, round_id, expires_at) VALUES
      ('${host.id}', '${event}', '${host.email}', 'Host', 'round_host', '${round}', now() + interval '30 days'),
      ('${venue.id}', '${event}', '${venue.email}', 'Venue', 'venue', NULL, now() + interval '30 days');
    INSERT INTO planning.logistics_items (id, event_id, position, label) VALUES ('${item}', '${event}', 1, 'HDMI');
    INSERT INTO planning.ideas (title, pitch, program) VALUES ('Secret idea', 'Private.', 'social');
  `);
  await provisionLoginRole(owner(db), DRAFT_COLLAB, "test-only");
  for (const statement of grantStatements()) await db.exec(statement);
});
afterAll(() => db.close());

/** Runs `statement` as draft_collab, signed in as `email`; the refusal, or undefined. */
async function refusalAs(
  email: string,
  statement: string,
): Promise<string | undefined> {
  await db.exec("BEGIN");
  try {
    await db.query(`SELECT set_config('collab.email', $1, true)`, [email]);
    await db.exec(`SET LOCAL ROLE ${DRAFT_COLLAB}`);
    await db.exec(statement);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await db.exec("ROLLBACK");
  }
}

describe("what the draft preview does, it may", () => {
  test("look up an evening by slug", async () => {
    expect(
      await refusalAs(
        host.email,
        `SELECT id, is_draft, end_date FROM public.events WHERE slug = 'x'`,
      ),
    ).toBeUndefined();
  });

  test("read the panel: memberships, roster, rounds, brief, tasks, logistics, comments", async () => {
    for (const statement of [
      `SELECT * FROM planning.collab_memberships()`,
      `SELECT * FROM planning.collab_roster('${event}')`,
      `SELECT id, title, questions, backups FROM planning.rounds`,
      `SELECT id, heading, body, audiences FROM planning.brief_sections`,
      `SELECT id, title, due_on, done_at FROM planning.tasks`,
      `SELECT id, label, detail FROM planning.logistics_items`,
      `SELECT id, author_name, body, created_at FROM planning.comments`,
      `SELECT id, stage, key_id, nonce, ciphertext FROM planning.round_submissions`,
      `SELECT decision, note FROM planning.reviews`,
      `SELECT planning.collab_recent_actions(now(), '{comment.add}')`,
    ]) {
      expect(`${statement}: ${await refusalAs(host.email, statement)}`).toBe(
        `${statement}: undefined`,
      );
    }
  });

  test("hand in a round, comment, confirm logistics and write the audit", async () => {
    expect(
      await refusalAs(
        host.email,
        `INSERT INTO planning.round_submissions (id, event_id, round_id, collaborator_id, stage, key_id, nonce, ciphertext)
         VALUES (gen_random_uuid(), '${event}', '${round}', '${host.id}', 'draft', 'k1', ${nonce}, ${sealed})`,
      ),
    ).toBeUndefined();
    expect(
      await refusalAs(
        host.email,
        `INSERT INTO planning.comments (event_id, collaborator_id, author_name, author_email, round_id, body)
         VALUES ('${event}', '${host.id}', 'Host', '${host.email}', '${round}', 'Draft is in')`,
      ),
    ).toBeUndefined();
    expect(
      await refusalAs(
        venue.email,
        `INSERT INTO planning.logistics_confirmations (event_id, item_id, collaborator_id, answer, note)
         VALUES ('${event}', '${item}', '${venue.id}', 'yes', 'Two of them')`,
      ),
    ).toBeUndefined();
    expect(
      await refusalAs(
        host.email,
        `INSERT INTO planning.collab_audit (actor_email, event_id, action, target_id, outcome, request_id)
         VALUES ('${host.email}', '${event}', 'round.save', NULL, 'ok', 'ray-1')`,
      ),
    ).toBeUndefined();
  });
});

describe("everything else, it may not", () => {
  test("read invitations, emails or the audit", async () => {
    for (const [statement, refusal] of [
      [
        `SELECT id FROM planning.collaborators`,
        "permission denied for table collaborators",
      ],
      [
        `SELECT author_email FROM planning.comments`,
        "permission denied for table comments",
      ],
      [
        `SELECT id FROM planning.collab_audit`,
        "permission denied for table collab_audit",
      ],
    ] as const) {
      expect(await refusalAs(host.email, statement)).toBe(refusal);
    }
  });

  test("change or delete anything", async () => {
    for (const table of [
      "rounds",
      "collaborators",
      "brief_sections",
      "tasks",
      "logistics_items",
      "logistics_confirmations",
      "round_submissions",
      "reviews",
      "comments",
      "collab_audit",
    ]) {
      expect(await refusalAs(host.email, `DELETE FROM planning.${table}`)).toBe(
        `permission denied for table ${table}`,
      );
      expect(
        await refusalAs(
          host.email,
          `UPDATE planning.${table} SET id = gen_random_uuid()`,
        ),
      ).toBe(`permission denied for table ${table}`);
      expect(await refusalAs(host.email, `TRUNCATE planning.${table}`)).toBe(
        `permission denied for table ${table}`,
      );
    }
  });

  test("write what the studio writes", async () => {
    for (const [table, statement] of [
      [
        "collaborators",
        `INSERT INTO planning.collaborators (event_id, email, name, role, expires_at) VALUES ('${event}', 'me@example.com', 'Me', 'organizer', now() + interval '1 day')`,
      ],
      [
        "brief_sections",
        `INSERT INTO planning.brief_sections (event_id, position, heading, body, audiences) VALUES ('${event}', 9, 'x', 'x', '{viewer}')`,
      ],
      [
        "reviews",
        `INSERT INTO planning.reviews (logistics_confirmation_id, decision, reviewer) VALUES (gen_random_uuid(), 'accepted', 'Me')`,
      ],
      [
        "tasks",
        `INSERT INTO planning.tasks (event_id, title) VALUES ('${event}', 'x')`,
      ],
      [
        "comments",
        `INSERT INTO planning.comments (event_id, collaborator_id, author_name, author_email, body, hidden_at) VALUES ('${event}', '${host.id}', 'Host', '${host.email}', 'x', now())`,
      ],
    ] as const) {
      expect(await refusalAs(host.email, statement)).toBe(
        `permission denied for table ${table}`,
      );
    }
  });

  test("reach the rest of planning or write public", async () => {
    expect(await refusalAs(host.email, `SELECT * FROM planning.ideas`)).toBe(
      "permission denied for table ideas",
    );
    expect(await refusalAs(host.email, `SELECT name FROM public.events`)).toBe(
      "permission denied for table events",
    );
    expect(await refusalAs(host.email, `SELECT id FROM public.profiles`)).toBe(
      "permission denied for table profiles",
    );
    expect(
      await refusalAs(host.email, `UPDATE public.events SET is_draft = false`),
    ).toBe("permission denied for table events");
    expect(
      await refusalAs(host.email, `CREATE TABLE planning.mine (id int)`),
    ).toBe("permission denied for schema planning");
  });
});

describe("its privileges in the catalog", () => {
  test("are exactly the script's", async () => {
    const { rows } = await db.query<{
      grant: string;
    }>(
      `SELECT table_schema || '.' || table_name || ' ' || lower(privilege_type) || ' ' || column_name AS grant
       FROM information_schema.column_privileges
       WHERE grantee = $1
       ORDER BY 1`,
      [DRAFT_COLLAB],
    );
    const expected = Object.entries(DRAFT_COLLAB_GRANTS)
      .flatMap(([table, grants]) =>
        (["select", "insert"] as const).flatMap((privilege) =>
          (grants[privilege] ?? []).map(
            (column) => `${table} ${privilege} ${column}`,
          ),
        ),
      )
      .toSorted();
    expect(rows.map((row) => row.grant)).toEqual(expected);

    const tables = await db.query<{ grant: string }>(
      `SELECT table_schema || '.' || table_name || ' ' || privilege_type AS grant
       FROM information_schema.table_privileges WHERE grantee = $1`,
      [DRAFT_COLLAB],
    );
    expect(tables.rows).toEqual([]);

    // Functions it may execute that PUBLIC may not: the script's, as
    // Postgres spells their signatures.
    const functions = await db.query<{ signature: string }>(
      `SELECT p.oid::regprocedure::text AS signature
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'planning')
         AND has_function_privilege($1, p.oid, 'EXECUTE')
         AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
       ORDER BY 1`,
      [DRAFT_COLLAB],
    );
    const declared = await db.query<{ signature: string }>(
      `SELECT unnest($1::text[])::regprocedure::text AS signature ORDER BY 1`,
      [DRAFT_COLLAB_FUNCTIONS],
    );
    expect(functions.rows).toEqual(declared.rows);
    expect(declared.rows).toHaveLength(DRAFT_COLLAB_FUNCTIONS.length);
  });

  test("bound every session", async () => {
    const { rows } = await db.query<{ setting: string }>(
      `SELECT unnest(setconfig) AS setting FROM pg_db_role_setting s
       JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1 ORDER BY 1`,
      [DRAFT_COLLAB],
    );
    expect(rows.map((row) => row.setting)).toEqual(
      Object.entries(DRAFT_COLLAB_SETTINGS)
        .map(([name, value]) => `${name}=${value}`)
        .toSorted(),
    );
  });

  test("bypass no row security", async () => {
    const { rows } = await db.query<{ bypass: boolean }>(
      `SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = $1`,
      [DRAFT_COLLAB],
    );
    expect(rows).toEqual([{ bypass: false }]);
  });
});
