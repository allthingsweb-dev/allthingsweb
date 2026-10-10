import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { basename } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import {
  provisionLoginRole,
  type Statements,
} from "../../infra/scripts/login-role.ts";
import {
  grantStatements as readerGrants,
  SITE_READER,
} from "../../infra/scripts/site-reader.ts";
import {
  grantStatements as syncGrants,
  SITE_SYNC,
} from "../../infra/scripts/site-sync.ts";
import {
  auditPlanning,
  isPrivate,
  siteRoles,
} from "../src/planning/privacy.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";
import { repositoryFiles, root } from "./support/repository.ts";

/**
 * Planning's rows (migrations/0012_planning.ts) are private, and these tests
 * hold them to it:
 *
 * - site_reader and site_sync, made and granted with their scripts' own
 *   statements, may not read or write any of it, even after a grant on
 *   every table in `public`, and `auditPlanning` (`bun run plan audit`)
 *   finds nothing; a grant that would expose it, it reports.
 * - No seed, fixture or backfill in this repository holds planning rows.
 */

const owner = (database: PGlite): Statements => ({
  unsafe: async (query, values) =>
    (await database.query(query, values === undefined ? [] : [...values])).rows,
});

/** Made-up rows in every planning table, so a read that got through would see some. */
const madeUp = `
  INSERT INTO planning.contacts (id, name) VALUES
    ('f1000000-0000-4000-8000-000000000001', 'Made-up Contact');
  INSERT INTO planning.ideas (title, pitch, program) VALUES ('Made-up idea', 'Made up.', 'social');
  INSERT INTO planning.wanted_speakers (id, contact_id) VALUES
    ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001');
  INSERT INTO planning.wanted_speaker_topics (wanted_speaker_id, topic) VALUES
    ('f2000000-0000-4000-8000-000000000001', 'ai');
  INSERT INTO planning.availability (wanted_speaker_id, note) VALUES
    ('f2000000-0000-4000-8000-000000000001', 'made up');
  INSERT INTO planning.host_prospects (company_name) VALUES ('Made-up Co');
  INSERT INTO planning.notes (contact_id, body) VALUES
    ('f1000000-0000-4000-8000-000000000001', 'Made up.');
  INSERT INTO planning.sent_posts (channel, event_id, moment, token)
    SELECT 'discord', id, 'announce', '0123456789abcdef' FROM events ORDER BY id LIMIT 1;
  INSERT INTO planning.draft_people (event_id, profile_id, role, position)
    SELECT e.id, p.id, 'mc', 0 FROM events e, profiles p ORDER BY e.id, p.id LIMIT 1;
  INSERT INTO planning.publishes (event_id, status, claimed_at)
    SELECT id, 'publishing', now() FROM events ORDER BY id LIMIT 1;
  CREATE TEMPORARY TABLE made_up_event AS SELECT id FROM events ORDER BY id LIMIT 1;
  INSERT INTO planning.rounds (id, event_id, position, title)
    SELECT 'f3000000-0000-4000-8000-000000000001', id, 1, 'Made-up round' FROM made_up_event;
  INSERT INTO planning.collaborators (id, event_id, email, name, role, round_id, expires_at)
    SELECT 'f4000000-0000-4000-8000-000000000001', id, 'made-up@example.com', 'Made Up',
      'round_host', 'f3000000-0000-4000-8000-000000000001', now() + interval '1 day'
    FROM made_up_event;
  INSERT INTO planning.brief_sections (id, event_id, position, heading, body, audiences)
    SELECT 'f5000000-0000-4000-8000-000000000001', id, 1, 'Made up', 'Made up.', '{viewer}'
    FROM made_up_event;
  INSERT INTO planning.tasks (event_id, title) SELECT id, 'Made up' FROM made_up_event;
  INSERT INTO planning.logistics_items (id, event_id, position, label)
    SELECT 'f6000000-0000-4000-8000-000000000001', id, 1, 'Made up' FROM made_up_event;
  INSERT INTO planning.logistics_confirmations (event_id, item_id, collaborator_id, answer)
    SELECT id, 'f6000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'yes'
    FROM made_up_event;
  INSERT INTO planning.round_submissions (id, event_id, round_id, collaborator_id, stage, key_id, nonce, ciphertext)
    SELECT 'f7000000-0000-4000-8000-000000000001', id, 'f3000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000001', 'draft', 'made-up',
      '\\x000000000000000000000000', '\\x0000000000000000000000000000000000'
    FROM made_up_event;
  INSERT INTO planning.reviews (round_submission_id, decision, reviewer)
    VALUES ('f7000000-0000-4000-8000-000000000001', 'accepted', 'Made Up');
  INSERT INTO planning.comments (event_id, collaborator_id, author_name, author_email, body)
    SELECT id, 'f4000000-0000-4000-8000-000000000001', 'Made Up', 'made-up@example.com', 'Made up.'
    FROM made_up_event;
  INSERT INTO planning.collab_audit (actor_email, action, outcome)
    VALUES ('made-up@example.com', 'comment.add', 'ok');
  INSERT INTO planning.draft_talks (id, event_id, position, kind, title)
    SELECT 'f8000000-0000-4000-8000-000000000001', id, 1, 'panel', 'Made-up panel'
    FROM made_up_event;
  INSERT INTO planning.draft_talk_people (draft_talk_id, wanted_speaker_id, role, position)
    VALUES ('f8000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'panelist', 0);
  INSERT INTO planning.draft_log (event_id, actor, command, summary)
    SELECT id, 'made-up', 'plan lineup set', 'Made up.' FROM made_up_event;
  INSERT INTO planning.draft_notes (event_id, actor, kind, text)
    SELECT id, 'made-up', 'question', 'Made up?' FROM made_up_event;
`;

let db: PGlite;
let tables: ReadonlyArray<string>;

beforeEach(async () => {
  db = await seededDatabase();
  await db.exec(madeUp);
  for (const [role, grants] of [
    [SITE_READER, readerGrants()],
    [SITE_SYNC, syncGrants()],
  ] as const) {
    await provisionLoginRole(owner(db), role, "test-only");
    for (const statement of grants) await db.exec(statement);
  }
  tables = (
    await db.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'planning' AND c.relkind = 'r' ORDER BY 1`,
    )
  ).rows.map((row) => row.name);
});
afterEach(() => db.close());

const audit = () =>
  Effect.runPromise(auditPlanning.pipe(Effect.provide(sqlLayer(db))));

/** The message Postgres refuses `statement` with as `role`, or undefined. */
const refusalAs = async (
  role: string,
  statement: string,
): Promise<string | undefined> => {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.exec(statement);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await db.exec("RESET ROLE");
  }
};

describe("planning is private", () => {
  test("every planning table holds a made-up row here", async () => {
    expect(tables).toEqual([
      "availability",
      "brief_sections",
      "collab_audit",
      "collaborators",
      "comments",
      "contacts",
      "draft_log",
      "draft_notes",
      "draft_people",
      "draft_talk_people",
      "draft_talks",
      "host_prospects",
      "ideas",
      "logistics_confirmations",
      "logistics_items",
      "notes",
      "publishes",
      "reviews",
      "round_submissions",
      "rounds",
      "sent_posts",
      "tasks",
      "wanted_speaker_topics",
      "wanted_speakers",
    ]);
    for (const table of tables) {
      const { rows } = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM planning.${table}`,
      );
      expect(rows[0]?.count).toBeGreaterThan(0);
    }
  });

  for (const role of siteRoles) {
    test(`${role} can neither read nor write any of it`, async () => {
      for (const table of tables) {
        expect(await refusalAs(role, `SELECT * FROM planning.${table}`)).toBe(
          "permission denied for schema planning",
        );
        expect(await refusalAs(role, `DELETE FROM planning.${table}`)).toBe(
          "permission denied for schema planning",
        );
      }
      expect(await refusalAs(role, `CREATE TABLE planning.mine (id int)`)).toBe(
        "permission denied for schema planning",
      );
      // It still reads what the site reads.
      expect(
        await refusalAs(role, `SELECT id FROM public.events LIMIT 1`),
      ).toBeUndefined();
    });
  }

  for (const role of siteRoles) {
    test(`${role} can't call planning's functions`, async () => {
      await db.exec(
        `SELECT set_config('collab.email', 'made-up@example.com', false)`,
      );
      for (const call of [
        `SELECT planning.collab_email()`,
        `SELECT planning.collab_is_organizer()`,
        `SELECT * FROM planning.collab_memberships()`,
        `SELECT planning.collab_has_role(gen_random_uuid(), '{viewer}')`,
        `SELECT planning.collab_hosts(gen_random_uuid())`,
        `SELECT * FROM planning.collab_roster(gen_random_uuid())`,
        `SELECT planning.collab_recent_actions(now(), '{comment.add}')`,
      ]) {
        expect(await refusalAs(role, call)).toBe(
          "permission denied for schema planning",
        );
      }
    });
  }

  test("not even a grant on every table in public reaches it", async () => {
    await db.exec(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${SITE_READER}`,
    );
    for (const table of tables) {
      expect(
        await refusalAs(SITE_READER, `SELECT * FROM planning.${table}`),
      ).toBe("permission denied for schema planning");
    }
  });

  test("the audit finds nothing", async () => {
    expect(await audit()).toEqual({
      schemaExists: true,
      relations: [...tables],
      checkedRoles: [SITE_READER, SITE_SYNC],
      exposures: [],
    });
  });

  test("the audit reports a function anyone may execute", async () => {
    // Postgres lets PUBLIC execute a new function until that is revoked, as
    // migrations/0026_draft_collaboration.ts does for each of its own.
    await db.exec(
      `CREATE FUNCTION planning.made_up() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    );
    expect((await audit()).exposures).toEqual([
      { role: "PUBLIC", object: "planning.made_up()", privilege: "EXECUTE" },
      { role: SITE_READER, object: "planning.made_up()", privilege: "EXECUTE" },
      { role: SITE_SYNC, object: "planning.made_up()", privilege: "EXECUTE" },
    ]);
    await db.exec(`REVOKE ALL ON FUNCTION planning.made_up() FROM PUBLIC`);
    expect((await audit()).exposures).toEqual([]);
  });

  test("an audit of a database without planning proves nothing", async () => {
    await db.exec("DROP SCHEMA planning CASCADE");
    const result = await audit();
    expect(result).toMatchObject({ schemaExists: false, exposures: [] });
    expect(isPrivate(result)).toBe(false);
  });

  test("the audit reports every grant that would expose it", async () => {
    await db.exec(`GRANT USAGE ON SCHEMA planning TO ${SITE_READER}`);
    await db.exec(`GRANT SELECT ON planning.ideas TO ${SITE_READER}`);
    await db.exec(`GRANT UPDATE (body) ON planning.notes TO ${SITE_SYNC}`);
    await db.exec(`GRANT SELECT ON planning.contacts TO PUBLIC`);
    expect((await audit()).exposures).toEqual([
      { role: "PUBLIC", object: "planning.contacts", privilege: "SELECT" },
      { role: SITE_READER, object: "planning.contacts", privilege: "SELECT" },
      { role: SITE_READER, object: "planning.ideas", privilege: "SELECT" },
      { role: SITE_READER, object: "schema planning", privilege: "USAGE" },
      {
        role: SITE_SYNC,
        object: "planning.contacts",
        privilege: "SELECT",
      },
      {
        role: SITE_SYNC,
        object: "planning.notes (a column)",
        privilege: "UPDATE",
      },
    ]);
  });
});

/**
 * Files that hold data rather than code: anything in a backfill, fixtures
 * or seed directory, anything named for a seed, and SQL or tabular data
 * outside the migrations that define the schema.
 */
const isDataFile = (path: string): boolean =>
  path
    .split("/")
    .some((part) => ["backfill", "fixtures", "seed", "seeds"].includes(part)) ||
  /seed/i.test(basename(path)) ||
  (/\.(sql|csv|tsv|jsonl|ndjson)$/.test(path) &&
    !path.startsWith("app/migrations/"));

/** production-schema.txt is the catalog: planning appears there only as schema. */
const catalog = "core/tests/fixtures/production-schema.txt";
const catalogLine =
  /^(relation|column|constraint|index|enum|type|sequence|view|trigger|policy|routine|comment) planning\.|^trigger CREATE TRIGGER [a-z_]+ [A-Z ]+ ON planning\.[a-z_]+ FOR EACH (ROW|STATEMENT) EXECUTE FUNCTION planning\.[a-z_]+\(\)$/;

describe("no planning rows in the repository", () => {
  const files = repositoryFiles().filter(isDataFile);

  test("finds the data files", () => {
    expect(files).toContain("core/tests/seed.sql");
    expect(files).toContain("core/backfill/hosts.json");
    expect(files).toContain(catalog);
  });

  test("no data file mentions the planning schema, but as schema in the catalog", async () => {
    const offending: Array<string> = [];
    for (const path of files) {
      const text = await Bun.file(`${root}${path}`).text();
      for (const [index, line] of text.split("\n").entries()) {
        if (!/\bplanning"?\s*\.\s*"?[a-z_]/i.test(line)) continue;
        if (path === catalog && catalogLine.test(line)) continue;
        offending.push(`${path}:${index + 1}`);
      }
    }
    expect(offending).toEqual([]);
  });

  test("no data file is named for a planning table", () => {
    const names = new Set(tables.map((table) => table.replaceAll("_", "")));
    const named = files.filter((path) => {
      const stem = basename(path)
        .replace(/\..*$/, "")
        .toLowerCase()
        .replaceAll(/[-_]/g, "");
      return names.has(stem) || names.has(`${stem}s`);
    });
    expect(named).toEqual([]);
  });

  test("the seeded database holds none", async () => {
    const seeded = await seededDatabase();
    try {
      for (const table of tables) {
        const { rows } = await seeded.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM planning.${table}`,
        );
        expect(`${table}: ${rows[0]?.count}`).toBe(`${table}: 0`);
      }
    } finally {
      await seeded.close();
    }
  });
});
