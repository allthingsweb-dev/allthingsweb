import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { draftCollaboration } from "../migrations/0026_draft_collaboration.ts";
import { seededDatabase } from "./support/database.ts";

/**
 * Row security on draft collaboration (migrations/0026_draft_collaboration.ts),
 * on its own: a probe role holds every privilege the collaboration role
 * could ever be given on these tables and functions, so whatever it can't
 * see or write here, the policies alone refuse. The collaboration role's
 * own, narrower grants are tested with its script.
 *
 * Two evenings: A, with two rounds, and B. On A: a viewer, a commenter, the
 * hosts of round 1 and round 2, a venue contact, an organizer of the
 * evening, and a revoked and an expired invitation. Someone on B only. The
 * stack's organizers sign in with `collab.organizer` set.
 */

const PROBE = "collab_probe";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const round1 = "a1000000-0000-4000-8000-000000000001";
const round2 = "a1000000-0000-4000-8000-000000000002";
const roundB = "b1000000-0000-4000-8000-000000000001";
const viewerSection = "a2000000-0000-4000-8000-000000000001";
const hostSection = "a2000000-0000-4000-8000-000000000002";
const organizerSection = "a2000000-0000-4000-8000-000000000003";
const venueItem = "a3000000-0000-4000-8000-000000000001";

const people = {
  viewer: {
    id: "a4000000-0000-4000-8000-000000000001",
    email: "viewer@example.com",
  },
  commenter: {
    id: "a4000000-0000-4000-8000-000000000002",
    email: "commenter@example.com",
  },
  host1: {
    id: "a4000000-0000-4000-8000-000000000003",
    email: "host1@example.com",
  },
  host2: {
    id: "a4000000-0000-4000-8000-000000000004",
    email: "host2@example.com",
  },
  venue: {
    id: "a4000000-0000-4000-8000-000000000005",
    email: "venue@example.com",
  },
  organizer: {
    id: "a4000000-0000-4000-8000-000000000006",
    email: "co-organizer@example.com",
  },
  revoked: {
    id: "a4000000-0000-4000-8000-000000000007",
    email: "revoked@example.com",
  },
  expired: {
    id: "a4000000-0000-4000-8000-000000000008",
    email: "expired@example.com",
  },
  onB: {
    id: "b4000000-0000-4000-8000-000000000001",
    email: "only-b@example.com",
  },
} as const;

const tables = [
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
] as const;

const submission1 = "a5000000-0000-4000-8000-000000000001";
const submission2 = "a5000000-0000-4000-8000-000000000002";
const nonce = `'\\x000000000000000000000000'`;
const sealed = `'\\x0000000000000000000000000000000000'`;

let db: PGlite;
/** The seed's ids for evenings A and B. */
let ids: Record<string, string> = {};

beforeAll(async () => {
  db = await seededDatabase();
  const [first, second] = (
    await db.query<{ id: string }>(`SELECT id FROM events ORDER BY id LIMIT 2`)
  ).rows;
  if (first === undefined || second === undefined) {
    throw new Error("the seed has fewer than two events");
  }
  const event = (id: string) => (id === A ? first.id : second.id);
  const invite = (
    person: { id: string; email: string },
    role: string,
    options: {
      event?: string;
      round?: string;
      expired?: boolean;
      revoked?: boolean;
    } = {},
  ) =>
    `INSERT INTO planning.collaborators (id, event_id, email, name, role, round_id, invited_at, expires_at, revoked_at)
     VALUES ('${person.id}', '${event(options.event ?? A)}', '${person.email}', '${person.email.split("@")[0]}', '${role}',
       ${options.round === undefined ? "NULL" : `'${options.round}'`},
       now() - interval '2 days',
       ${options.expired === true ? "now() - interval '1 day'" : "now() + interval '30 days'"},
       ${options.revoked === true ? "now() - interval '1 day'" : "NULL"})`;
  await db.exec(`
    INSERT INTO planning.rounds (id, event_id, position, title) VALUES
      ('${round1}', '${first.id}', 1, 'Round one'),
      ('${round2}', '${first.id}', 2, 'Round two'),
      ('${roundB}', '${second.id}', 1, 'Round on B');
    ${invite(people.viewer, "viewer")};
    ${invite(people.commenter, "commenter")};
    ${invite(people.host1, "round_host", { round: round1 })};
    ${invite(people.host2, "round_host", { round: round2 })};
    ${invite(people.venue, "venue")};
    ${invite(people.organizer, "organizer")};
    ${invite(people.revoked, "commenter", { revoked: true })};
    ${invite(people.expired, "commenter", { expired: true })};
    ${invite(people.onB, "commenter", { event: B })};
    INSERT INTO planning.brief_sections (id, event_id, position, heading, body, audiences) VALUES
      ('${viewerSection}', '${first.id}', 1, 'The pitch', 'For everyone.', '{viewer,commenter,round_host,venue}'),
      ('${hostSection}', '${first.id}', 2, 'Writing your round', 'For hosts.', '{round_host}'),
      ('${organizerSection}', '${first.id}', 3, 'Venues', 'Organizers only.', '{organizer}');
    INSERT INTO planning.tasks (event_id, title, role, collaborator_id) VALUES
      ('${first.id}', 'Everyone', NULL, NULL),
      ('${first.id}', 'Hosts', 'round_host', NULL),
      ('${first.id}', 'Host one', NULL, '${people.host1.id}');
    INSERT INTO planning.logistics_items (id, event_id, position, label) VALUES
      ('${venueItem}', '${first.id}', 1, 'Projector with HDMI');
    INSERT INTO planning.round_submissions (id, event_id, round_id, collaborator_id, stage, key_id, nonce, ciphertext) VALUES
      ('${submission1}', '${first.id}', '${round1}', '${people.host1.id}', 'draft', 'k1', ${nonce}, ${sealed}),
      ('${submission2}', '${first.id}', '${round2}', '${people.host2.id}', 'draft', 'k1', ${nonce}, ${sealed});
    INSERT INTO planning.reviews (round_submission_id, decision, reviewer) VALUES
      ('${submission1}', 'changes_requested', 'Erik'),
      ('${submission2}', 'accepted', 'Erik');
    INSERT INTO planning.comments (event_id, collaborator_id, author_name, author_email, section_id, round_id, body) VALUES
      ('${first.id}', '${people.commenter.id}', 'commenter', '${people.commenter.email}', NULL, NULL, 'On the evening'),
      ('${first.id}', '${people.host1.id}', 'host1', '${people.host1.email}', '${hostSection}', NULL, 'On the hosts'' section'),
      ('${first.id}', '${people.host1.id}', 'host1', '${people.host1.email}', NULL, '${round1}', 'On round one'),
      ('${first.id}', '${people.host2.id}', 'host2', '${people.host2.email}', NULL, '${round2}', 'On round two');
    INSERT INTO planning.comments (event_id, collaborator_id, author_name, author_email, body, hidden_at) VALUES
      ('${first.id}', '${people.commenter.id}', 'commenter', '${people.commenter.email}', 'Hidden', now());
    INSERT INTO planning.collab_audit (actor_email, event_id, action, outcome) VALUES
      ('${people.host1.email}', '${first.id}', 'round.save', 'ok'),
      ('${people.host2.email}', '${first.id}', 'round.save', 'ok');
    CREATE ROLE ${PROBE} NOLOGIN;
    GRANT USAGE ON SCHEMA planning TO ${PROBE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ${tables.map((table) => `planning.${table}`).join(", ")} TO ${PROBE};
    GRANT SELECT ON public.events TO ${PROBE};
  `);
  for (const statement of draftCollaboration) {
    const routine = /^REVOKE ALL ON FUNCTION (.+) FROM PUBLIC$/.exec(statement);
    if (routine !== null) {
      await db.exec(`GRANT EXECUTE ON FUNCTION ${routine[1]} TO ${PROBE}`);
    }
  }
  // The tests name evenings A and B; the rows hold the seed's ids.
  ids = { [A]: first.id, [B]: second.id };
});
afterAll(() => db.close());

/** A row as Postgres returns it, read a column at a time. */
type Row = Readonly<Record<string, unknown>>;

interface Asker {
  readonly email?: string;
  readonly organizer?: boolean;
}

/** Runs `query` as the probe, signed in as `asker`; its rows, or the refusal. */
async function as(
  asker: Asker,
  query: string,
): Promise<{ rows: ReadonlyArray<Row>; error?: string }> {
  await db.exec("BEGIN");
  try {
    await db.query(`SELECT set_config('collab.email', $1, true)`, [
      asker.email ?? "",
    ]);
    await db.query(`SELECT set_config('collab.organizer', $1, true)`, [
      asker.organizer === true ? "on" : "",
    ]);
    await db.exec(`SET LOCAL ROLE ${PROBE}`);
    const { rows } = await db.query<Row>(
      query.replaceAll(":A", ids[A] ?? "").replaceAll(":B", ids[B] ?? ""),
    );
    return { rows };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await db.exec("ROLLBACK");
  }
}

const sortedIds = (rows: ReadonlyArray<Row>) =>
  rows.map((row) => String(row["id"])).toSorted();
const titles = async (asker: Asker, table: string, column: string) =>
  (
    await as(
      asker,
      `SELECT ${column} AS value FROM planning.${table} ORDER BY 1`,
    )
  ).rows.map((row) => row["value"]);

const policyRefusal = (table: string) =>
  `new row violates row-level security policy for table "${table}"`;

describe("no one signed in", () => {
  test("sees no row of any table", async () => {
    for (const table of tables) {
      const { rows, error } = await as(
        {},
        `SELECT count(*)::int AS count FROM planning.${table}`,
      );
      expect(`${table}: ${error ?? String(rows[0]?.["count"])}`).toBe(
        `${table}: 0`,
      );
    }
  });

  test("is no organizer, even with the setting on", async () => {
    const { rows } = await as(
      { organizer: true },
      `SELECT count(*)::int AS count FROM planning.rounds`,
    );
    expect(rows[0]?.["count"]).toBe(0);
  });
});

describe("a collaborator", () => {
  test("reads no invitation directly, not even their own", async () => {
    for (const person of Object.values(people)) {
      const { rows } = await as(
        { email: person.email },
        `SELECT count(*)::int AS count FROM planning.collaborators`,
      );
      expect(rows[0]?.["count"]).toBe(0);
    }
  });

  test("sees only their own evening's rounds", async () => {
    expect(
      await titles({ email: people.viewer.email }, "rounds", "title"),
    ).toEqual(["Round one", "Round two"]);
    expect(
      await titles({ email: people.onB.email }, "rounds", "title"),
    ).toEqual(["Round on B"]);
  });

  test("sees the brief's sections for their role, never the organizers'", async () => {
    expect(
      await titles({ email: people.viewer.email }, "brief_sections", "heading"),
    ).toEqual(["The pitch"]);
    expect(
      await titles({ email: people.host1.email }, "brief_sections", "heading"),
    ).toEqual(["The pitch", "Writing your round"]);
    expect(
      await titles({ email: people.onB.email }, "brief_sections", "heading"),
    ).toEqual([]);
  });

  test("sees the tasks for everyone, their role, and themselves", async () => {
    expect(
      await titles({ email: people.viewer.email }, "tasks", "title"),
    ).toEqual(["Everyone"]);
    expect(
      await titles({ email: people.host1.email }, "tasks", "title"),
    ).toEqual(["Everyone", "Host one", "Hosts"]);
    expect(
      await titles({ email: people.host2.email }, "tasks", "title"),
    ).toEqual(["Everyone", "Hosts"]);
  });

  test("revoked or expired, sees nothing", async () => {
    for (const person of [people.revoked, people.expired]) {
      for (const table of tables) {
        const { rows } = await as(
          { email: person.email },
          `SELECT count(*)::int AS count FROM planning.${table}`,
        );
        expect(`${person.email} ${table}: ${String(rows[0]?.["count"])}`).toBe(
          `${person.email} ${table}: 0`,
        );
      }
    }
  });

  test("is matched by email in any case", async () => {
    expect(
      await titles({ email: "VIEWER@Example.com" }, "rounds", "title"),
    ).toEqual(["Round one", "Round two"]);
  });

  test("sees the others' names and roles, but no email", async () => {
    const { rows } = await as(
      { email: people.viewer.email },
      `SELECT name, role, email FROM planning.collab_roster(':A') ORDER BY name`,
    );
    expect(
      rows.map((row) =>
        [row["name"], row["role"], row["email"]].map(String).join(" "),
      ),
    ).toEqual([
      "co-organizer organizer null",
      "commenter commenter null",
      "host1 round_host null",
      "host2 round_host null",
      "venue venue null",
      "viewer viewer null",
    ]);
    expect(
      (
        await as(
          { email: people.onB.email },
          `SELECT * FROM planning.collab_roster(':A')`,
        )
      ).rows,
    ).toEqual([]);
  });
});

describe("a round's secrecy", () => {
  test("a host sees their own round's submissions and reviews, never another's", async () => {
    expect(
      sortedIds(
        (
          await as(
            { email: people.host1.email },
            `SELECT id FROM planning.round_submissions`,
          )
        ).rows,
      ),
    ).toEqual([submission1]);
    expect(
      (
        await as(
          { email: people.host1.email },
          `SELECT decision FROM planning.reviews`,
        )
      ).rows,
    ).toEqual([{ decision: "changes_requested" }]);
    expect(
      sortedIds(
        (
          await as(
            { email: people.host2.email },
            `SELECT id FROM planning.round_submissions`,
          )
        ).rows,
      ),
    ).toEqual([submission2]);
  });

  test("no one else on the evening sees any", async () => {
    for (const person of [
      people.viewer,
      people.commenter,
      people.venue,
      people.onB,
    ]) {
      expect(
        (
          await as(
            { email: person.email },
            `SELECT id FROM planning.round_submissions`,
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await as({ email: person.email }, `SELECT id FROM planning.reviews`))
          .rows,
      ).toEqual([]);
    }
  });

  test("a host hands in only for their own round, as themselves", async () => {
    const insert = (round: string, collaborator: string) =>
      `INSERT INTO planning.round_submissions (event_id, round_id, collaborator_id, stage, key_id, nonce, ciphertext)
       VALUES (':A', '${round}', '${collaborator}', 'final', 'k1', ${nonce}, ${sealed})`;
    expect(
      (await as({ email: people.host1.email }, insert(round1, people.host1.id)))
        .error,
    ).toBeUndefined();
    expect(
      (await as({ email: people.host1.email }, insert(round2, people.host1.id)))
        .error,
    ).toBe(policyRefusal("round_submissions"));
    expect(
      (await as({ email: people.host1.email }, insert(round2, people.host2.id)))
        .error,
    ).toBe(policyRefusal("round_submissions"));
    expect(
      (
        await as(
          { email: people.viewer.email },
          insert(round1, people.host1.id),
        )
      ).error,
    ).toBe(policyRefusal("round_submissions"));
  });

  test("comments on a round show only to its hosts and the organizers", async () => {
    expect(
      await titles({ email: people.host1.email }, "comments", "body"),
    ).toEqual(["On round one", "On the evening", "On the hosts' section"]);
    expect(
      await titles({ email: people.viewer.email }, "comments", "body"),
    ).toEqual(["On the evening"]);
    expect(
      await titles({ email: people.organizer.email }, "comments", "body"),
    ).toEqual([
      "On round one",
      "On round two",
      "On the evening",
      "On the hosts' section",
    ]);
  });
});

describe("organizers", () => {
  const stack = { email: "erik@example.com", organizer: true };

  test("the stack's see every row but the invitations and the audit", async () => {
    expect(await titles(stack, "brief_sections", "heading")).toEqual([
      "The pitch",
      "Venues",
      "Writing your round",
    ]);
    expect(
      sortedIds(
        (await as(stack, `SELECT id FROM planning.round_submissions`)).rows,
      ),
    ).toEqual([submission1, submission2]);
    expect(await titles(stack, "rounds", "title")).toEqual([
      "Round on B",
      "Round one",
      "Round two",
    ]);
    expect(
      (await as(stack, `SELECT id FROM planning.collaborators`)).rows,
    ).toEqual([]);
    expect(
      (await as(stack, `SELECT id FROM planning.collab_audit`)).rows,
    ).toEqual([]);
  });

  test("an evening's organizer sees all of it, and the emails, but no other evening", async () => {
    const organizer = { email: people.organizer.email };
    expect(await titles(organizer, "brief_sections", "heading")).toEqual([
      "The pitch",
      "Venues",
      "Writing your round",
    ]);
    expect(await titles(organizer, "rounds", "title")).toEqual([
      "Round one",
      "Round two",
    ]);
    const { rows } = await as(
      organizer,
      `SELECT email FROM planning.collab_roster(':A') ORDER BY email`,
    );
    expect(rows.map((row) => row["email"])).toEqual([
      people.organizer.email,
      people.commenter.email,
      people.host1.email,
      people.host2.email,
      people.venue.email,
      people.viewer.email,
    ]);
  });
});

describe("what collaborators write", () => {
  const comment = (
    author: { id: string; email: string } | null,
    email: string,
    extra = "",
  ) =>
    `INSERT INTO planning.comments (event_id, collaborator_id, author_name, author_email, body${extra === "" ? "" : ", round_id"})
     VALUES (':A', ${author === null ? "NULL" : `'${author.id}'`}, 'x', '${email}', 'Hello'${extra === "" ? "" : `, '${extra}'`})`;

  test("a commenter comments as themselves, a viewer can't comment", async () => {
    expect(
      (
        await as(
          { email: people.commenter.email },
          comment(people.commenter, people.commenter.email),
        )
      ).error,
    ).toBeUndefined();
    expect(
      (
        await as(
          { email: people.commenter.email },
          comment(people.commenter, people.viewer.email),
        )
      ).error,
    ).toBe(policyRefusal("comments"));
    expect(
      (
        await as(
          { email: people.commenter.email },
          comment(people.viewer, people.commenter.email),
        )
      ).error,
    ).toBe(policyRefusal("comments"));
    expect(
      (
        await as(
          { email: people.viewer.email },
          comment(people.viewer, people.viewer.email),
        )
      ).error,
    ).toBe(policyRefusal("comments"));
    expect(
      (
        await as(
          { email: people.onB.email },
          comment(people.onB, people.onB.email),
        )
      ).error,
    ).toBe(policyRefusal("comments"));
  });

  test("a host comments on their round only; the stack's organizers anywhere", async () => {
    expect(
      (
        await as(
          { email: people.host1.email },
          comment(people.host1, people.host1.email, round1),
        )
      ).error,
    ).toBeUndefined();
    expect(
      (
        await as(
          { email: people.host1.email },
          comment(people.host1, people.host1.email, round2),
        )
      ).error,
    ).toBe(policyRefusal("comments"));
    expect(
      (
        await as(
          { email: "erik@example.com", organizer: true },
          comment(null, "erik@example.com", round2),
        )
      ).error,
    ).toBeUndefined();
    expect(
      (
        await as(
          { email: people.commenter.email },
          comment(null, people.commenter.email),
        )
      ).error,
    ).toBe(policyRefusal("comments"));
  });

  test("only the venue confirms logistics, as themselves", async () => {
    const confirm = (collaborator: string) =>
      `INSERT INTO planning.logistics_confirmations (event_id, item_id, collaborator_id, answer)
       VALUES (':A', '${venueItem}', '${collaborator}', 'yes')`;
    expect(
      await titles({ email: people.venue.email }, "logistics_items", "label"),
    ).toEqual(["Projector with HDMI"]);
    expect(
      await titles({ email: people.viewer.email }, "logistics_items", "label"),
    ).toEqual([]);
    expect(
      (await as({ email: people.venue.email }, confirm(people.venue.id))).error,
    ).toBeUndefined();
    expect(
      (await as({ email: people.viewer.email }, confirm(people.viewer.id)))
        .error,
    ).toBe(policyRefusal("logistics_confirmations"));
    expect(
      (await as({ email: people.viewer.email }, confirm(people.venue.id)))
        .error,
    ).toBe(policyRefusal("logistics_confirmations"));
  });

  test("the audit takes rows only in the asker's name, and counts only theirs", async () => {
    const audit = (email: string) =>
      `INSERT INTO planning.collab_audit (actor_email, action, outcome) VALUES ('${email}', 'comment.add', 'ok')`;
    expect(
      (await as({ email: people.host1.email }, audit(people.host1.email)))
        .error,
    ).toBeUndefined();
    expect(
      (await as({ email: people.host1.email }, audit(people.host2.email)))
        .error,
    ).toBe(policyRefusal("collab_audit"));
    const { rows } = await as(
      { email: people.host1.email },
      `SELECT planning.collab_recent_actions(now() - interval '1 hour', '{round.save}') AS count`,
    );
    expect(Number(rows[0]?.["count"])).toBe(1);
  });

  test("nothing handed in can be changed or deleted", async () => {
    const host = { email: people.host1.email };
    for (const statement of [
      `UPDATE planning.round_submissions SET stage = 'final'`,
      `DELETE FROM planning.round_submissions`,
      `UPDATE planning.comments SET body = 'changed'`,
      `DELETE FROM planning.comments`,
      `DELETE FROM planning.collab_audit`,
    ]) {
      const before = (
        await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM planning.round_submissions`,
        )
      ).rows[0]?.["count"];
      const result = await as(host, `${statement} RETURNING 1`);
      // No policy allows it: the statement touches no row.
      expect(`${statement}: ${result.error ?? result.rows.length}`).toBe(
        `${statement}: 0`,
      );
      expect(
        (
          await db.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM planning.round_submissions`,
          )
        ).rows[0]?.["count"],
      ).toBe(before);
    }
  });
});
