/**
 * Creates studio, or gives it a new password: the login role the event
 * studio's commands connect as (core's README, "The studio's connection"):
 * planning, readiness, Luma, social, posts, and the studio's edits of
 * photos, profile photos, hosts' logos and talks. It holds exactly
 * STUDIO_GRANTS and nothing else, from those commands' own SQL:
 *
 * - planning: the tables the studio keeps (ideas, wanted speakers, host
 *   prospects, contacts, notes, a draft's lineup and talks, publishes, sent
 *   posts), read whole, and written only in the columns and ways its
 *   commands write them. Nothing on the ten collaboration tables
 *   (migrations/0026_draft_collaboration.ts): they have row security, which
 *   this role doesn't bypass, so `bun run collab` stays the owner's (see
 *   OWNER_ONLY) and readiness leaves collaboration's advice out as it.
 * - public: reads only tables site_reader already reads
 *   (infra/scripts/site-reader.ts), so it sees nothing the site doesn't
 *   publish; writes only the columns its commands write.
 * - No function, no sequence, no DDL, no ownership, no TRUNCATE, and no
 *   BYPASSRLS (provisionLoginRole checks): migrations stay the owner's.
 *
 * Every run revokes what the role holds before granting, so a narrower list
 * here narrows the role. core/tests/studio-role.test.ts makes the role with
 * these statements, checks what its commands do succeeds and everything
 * else is refused, and that its privileges in the catalog are exactly
 * these; `bun run test:studio` in core runs the studio's own test suites
 * as it.
 *
 * Like site_sync it is created with SQL by the database owner, never in
 * Neon's console or API, because roles made there join neon_superuser. The
 * connection string goes straight into the 1Password item "allthings
 * studio" (field `credential`) in the allthings vault, through `op` (with
 * OP_SERVICE_ACCOUNT_TOKEN, or your own session); it is never printed, and
 * no repository secret holds it: nothing in CI connects as the studio. Run
 * it from the repository root with the owner's connection string in the
 * environment, passed without printing it, first as a plan, then to apply:
 *
 *   OWNER_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
 *     --project-id wispy-sea-75401301 --role-name neondb_owner --database-name neondb) \
 *     bun infra/scripts/studio.ts --dry-run
 *
 * --dry-run makes the role and runs every grant in a transaction that is
 * rolled back, and prints how its privileges would change and where its
 * credential would go. --apply does it, then checks the result: the
 * catalog holds exactly STUDIO_GRANTS, and the connection string read back
 * from 1Password signs in as the studio.
 *
 * VAULT names the 1Password vault (default: allthings).
 */
import {
  connectionStringFor,
  newPassword,
  provisionLoginRole,
  run,
  type Statements,
  storeItem,
} from "./login-role.ts";

export const STUDIO = "studio";

/**
 * The commands that connect as the studio, as core's `bun run` names them:
 * the script, then the subcommand or flag that makes an invocation the
 * studio's (`people photo` is, `people --dry-run`, a backfill, isn't).
 * core/tests/vault.test.ts holds every documented invocation of one to
 * the studio's credential, and only those; core/tests/studio-role.test.ts
 * holds each to suites that `bun run test:studio` runs as the role. Their
 * subcommands that reach no database (`luma show`, `luma calendar`,
 * `social x-sign-in`) aren't listed.
 */
export const STUDIO_COMMANDS = [
  "plan",
  "readiness",
  "luma create",
  "luma update",
  "luma publish",
  "luma cover",
  "luma:drafts --add",
  "social bluesky",
  "social discord",
  "social x",
  "posts",
  "photos",
  "people photo",
  "hosts logo",
  "talks",
] as const;

/** Whether `bun run <script> <args…>` is one of STUDIO_COMMANDS. */
export const studioCommandOf = (
  script: string,
  args: ReadonlyArray<string>,
): (typeof STUDIO_COMMANDS)[number] | undefined =>
  STUDIO_COMMANDS.find((command) => {
    const [name, ...needs] = command.split(" ");
    return name === script && needs.every((need) => args.includes(need));
  });

/**
 * What a role may do with one table: SELECT the whole table or nothing
 * (`select: true`), and INSERT and UPDATE by column, DELETE the whole row.
 */
export interface TableGrants {
  readonly select?: true;
  readonly insert?: ReadonlyArray<string>;
  readonly update?: ReadonlyArray<string>;
  readonly delete?: true;
}

/**
 * Each table's grants, schema-qualified, each matched to the commands
 * whose statements need it. An UPDATE marked "the lock" is there only
 * because Postgres asks UPDATE on a column of any row a statement locks
 * (`FOR UPDATE`); the commands never set that column on it.
 */
export const STUDIO_GRANTS: Readonly<Record<string, TableGrants>> = {
  // ── planning (src/planning/, src/luma/publish.ts, src/social/sent-posts.ts)
  // plan speaker add, host add (a new contact).
  "planning.contacts": {
    select: true,
    insert: ["name", "email", "url", "sponsor_id"],
  },
  // plan idea add / update; read by readiness, luma create --idea, publish.
  "planning.ideas": {
    select: true,
    insert: [
      "title",
      "pitch",
      "program",
      "topic",
      "status",
      "event_id",
      "inspired_by_event_id",
    ],
    update: [
      "title",
      "pitch",
      "program",
      "topic",
      "status",
      "event_id",
      "inspired_by_event_id",
      "updated_at",
    ],
  },
  // plan speaker add / update.
  "planning.wanted_speakers": {
    select: true,
    insert: ["profile_id", "contact_id", "status", "note"],
    update: ["status", "note", "updated_at"],
  },
  // plan speaker add / update --add-topic, --remove-topic.
  "planning.wanted_speaker_topics": {
    select: true,
    insert: ["wanted_speaker_id", "topic"],
    delete: true,
  },
  // plan speaker add / update --add-window, --remove-window.
  "planning.availability": {
    select: true,
    insert: ["wanted_speaker_id", "kind", "starts_on", "ends_on", "note"],
    delete: true,
  },
  // plan host add / update.
  "planning.host_prospects": {
    select: true,
    insert: ["sponsor_id", "company_name", "contact_id", "status", "note"],
    update: ["status", "note", "updated_at"],
  },
  // plan note add.
  "planning.notes": {
    select: true,
    insert: ["profile_id", "sponsor_id", "contact_id", "body", "author"],
  },
  // plan lineup set (replaced whole); read by readiness and publish.
  "planning.draft_people": {
    select: true,
    insert: ["event_id", "profile_id", "role", "position"],
    delete: true,
  },
  // plan lineup talk add / remove; read by readiness.
  "planning.draft_talks": {
    select: true,
    insert: ["event_id", "position", "kind", "title", "description"],
    delete: true,
  },
  "planning.draft_talk_people": {
    select: true,
    insert: ["draft_talk_id", "wanted_speaker_id", "role", "position"],
    delete: true,
  },
  // luma publish --approve: the claim, published, or let go when Luma
  // didn't take it.
  "planning.publishes": {
    select: true,
    insert: ["event_id", "status", "claimed_at"],
    update: ["status", "claimed_at", "published_at"],
    delete: true,
  },
  // social discord / x: the claim, sent, unanswered, dropped or released.
  "planning.sent_posts": {
    select: true,
    insert: ["channel", "event_id", "moment", "token", "body", "claimed_at"],
    update: ["status", "message_id", "url", "sent_at", "claimed_at"],
    delete: true,
  },

  // ── public: reads (each a table site_reader reads) and the studio's writes
  // luma:drafts --add stores a private event as the sync would; publish
  // writes the idea's program; luma cover records the cover it set and
  // lets go of the stored copy of the old one (preview_image), and
  // photos remove and plan lineup set lock the evening.
  "public.events": {
    select: true,
    insert: [
      "luma_event_id",
      "name",
      "start_date",
      "end_date",
      "is_draft",
      "slug",
      "tagline",
      "attendee_limit",
      "street_address",
      "short_location",
      "full_address",
      "luma_description",
      "luma_summary",
      "created_at",
      "updated_at",
    ],
    update: [
      "program",
      "generated_cover_url",
      "generated_cover_sha256",
      "generated_cover_facts",
      "preview_image",
      "updated_at",
    ],
  },
  // luma publish --approve copies the draft's lineup here, and takes it
  // back off when Luma didn't take the publish.
  "public.event_people": {
    select: true,
    insert: [
      "event_id",
      "profile_id",
      "role",
      "position",
      "source",
      "created_at",
      "updated_at",
    ],
    delete: true,
  },
  // photos add / replace / remove, people photo, hosts logo: a new image's
  // row, and an old one nothing points at any more; updated_at for the lock.
  "public.images": {
    select: true,
    insert: [
      "id",
      "url",
      "alt",
      "placeholder",
      "width",
      "height",
      "created_at",
      "updated_at",
    ],
    update: ["updated_at"],
    delete: true,
  },
  // photos add / replace / remove; updated_at for the lock.
  "public.event_images": {
    select: true,
    insert: ["event_id", "image_id", "created_at", "updated_at"],
    update: ["updated_at"],
    delete: true,
  },
  // people photo --approve.
  "public.profiles": {
    select: true,
    update: ["image", "updated_at"],
  },
  // hosts logo --approve.
  "public.sponsors": {
    select: true,
    update: ["square_logo_dark", "square_logo_light", "updated_at"],
  },
  // talks update --approve.
  "public.talks": {
    select: true,
    update: ["title", "description", "updated_at"],
  },
  // talks update --approve: a changed list of speakers replaces the old.
  "public.talk_speakers": {
    select: true,
    insert: ["talk_id", "speaker_id", "role", "created_at", "updated_at"],
    delete: true,
  },
  // posts add / apply / find (a found post goes in pending), approve,
  // hide, move.
  "public.event_posts": {
    select: true,
    insert: [
      "event_id",
      "platform",
      "url",
      "author_name",
      "author_handle",
      "author_url",
      "author_avatar_source_url",
      "posted_at",
      "text",
      "image_source_url",
      "status",
      "updated_at",
    ],
    update: ["event_id", "status", "updated_at"],
  },
  // Read for an evening's page, its readiness, covers, drafts and posts.
  "public.event_sponsors": { select: true },
  "public.event_talks": { select: true },
  "public.event_schedule_items": { select: true },
  "public.event_notes": { select: true },
  "public.event_slugs": { select: true },
};

/**
 * What stays the owner's, and why: no grant would do, short of
 * BYPASSRLS, which only a superuser can give and this role must never
 * have, or what the role exists to keep from every agent.
 */
export const OWNER_ONLY: ReadonlyArray<{
  readonly what: string;
  readonly why: string;
}> = [
  {
    what: "migrations (`bun run migrate`, `migrate stamp`)",
    why: "DDL and ownership of every table: no login role in the vault may change the schema.",
  },
  {
    what: "`bun run collab` (every subcommand that reads the database)",
    why: "The ten collaboration tables have row security (migrations/0026_draft_collaboration.ts). Only the owner bypasses it; any other role sees only what a signed-in collaborator may, collaborators nothing at all, and may write none of what the studio writes, so a grant would make collab read empty, not work. Giving the studio its own policies is a migration of its own.",
  },
  {
    what: "the backfills: `bun run people`, `hosts`, `lineups`, `programs`, `curation`, `event-extras`, `external-talks`, `luma:people`",
    why: "They rewrite the public record from files reviewed in pull requests: they create profiles and companies, delete talks and people's parts, and set venues and recordings. That is most of public's write surface, which a role every agent can read must not hold.",
  },
];

/**
 * The functions of ours the role may execute, all because PUBLIC may, as it
 * may every function nobody revoked it on: none is granted to it. They
 * change nothing and see nothing a caller couldn't: a pure function of a
 * name, and two trigger functions, which Postgres runs only as triggers.
 * Revoking PUBLIC's EXECUTE on them would be a migration, and would break
 * the profiles_slug trigger, which calls person_slug as whoever inserts a
 * profile. core/tests/studio-role.test.ts fails when the role may execute
 * any other (a new function left to PUBLIC), or any that is SECURITY
 * DEFINER: that is a decision for its migration, to revoke PUBLIC or list
 * it here.
 */
export const STUDIO_PUBLIC_FUNCTIONS: ReadonlyArray<string> = [
  "public.person_slug(text)",
  "public.profiles_slug()",
  "public.profiles_x_followers_reset()",
];

/**
 * Bounds on every session: a studio command runs a few short statements,
 * and keeps no transaction open while it calls Luma, X, Discord or the
 * upload Worker.
 */
export const STUDIO_SETTINGS = {
  statement_timeout: "30s",
  lock_timeout: "5s",
  idle_in_transaction_session_timeout: "30s",
} as const;

/** Column names as SQL identifiers, comma-separated. */
const quoted = (columns: ReadonlyArray<string>) =>
  columns.map((column) => `"${column}"`).join(", ");

/** `schema.table` as a quoted SQL identifier. */
const qualified = (table: string) => {
  const [schema, name] = table.split(".");
  return `"${schema}"."${name}"`;
};

/** The SQL that leaves `role` with exactly STUDIO_GRANTS and the settings, run as the owner. */
export function grantStatements(role = STUDIO): string[] {
  const statements: string[] = [];
  for (const schema of ["public", "planning"]) {
    statements.push(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}`,
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${role}`,
      `REVOKE ALL ON SCHEMA ${schema} FROM ${role}`,
      `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
    );
  }
  for (const [table, grants] of Object.entries(STUDIO_GRANTS)) {
    const whole = [
      ...(grants.select === true ? ["SELECT"] : []),
      ...(grants.delete === true ? ["DELETE"] : []),
    ];
    if (whole.length > 0) {
      statements.push(
        `GRANT ${whole.join(", ")} ON ${qualified(table)} TO ${role}`,
      );
    }
    for (const privilege of ["insert", "update"] as const) {
      const columns = grants[privilege];
      if (columns !== undefined && columns.length > 0) {
        statements.push(
          `GRANT ${privilege.toUpperCase()} (${quoted(columns)}) ON ${qualified(table)} TO ${role}`,
        );
      }
    }
  }
  for (const [name, value] of Object.entries(STUDIO_SETTINGS)) {
    statements.push(`ALTER ROLE ${role} SET ${name} = '${value}'`);
  }
  return statements;
}

/**
 * The role's privileges as the catalog holds them, one line each: a
 * table's (`planning.ideas select`), a column's
 * (`planning.ideas insert title`) and a schema's (`schema public usage`).
 */
export const grantedQuery = `
  SELECT n.nspname || '.' || c.relname || ' ' || lower(a.privilege_type) AS grant
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
  ORDER BY 1`;

/** What {@link grantedQuery} reads once {@link grantStatements} has run: STUDIO_GRANTS, line by line. */
export function expectedPrivileges(): string[] {
  return [
    "schema planning usage",
    "schema public usage",
    ...Object.entries(STUDIO_GRANTS).flatMap(([table, grants]) => [
      ...(grants.select === true ? [`${table} select`] : []),
      ...(grants.delete === true ? [`${table} delete`] : []),
      ...(grants.insert ?? []).map((column) => `${table} insert ${column}`),
      ...(grants.update ?? []).map((column) => `${table} update ${column}`),
    ]),
  ].toSorted();
}

/** The role's privileges, read with {@link grantedQuery} as whoever `sql` is. */
const granted = async (sql: Statements): Promise<string[]> =>
  ((await sql.unsafe(grantedQuery, [STUDIO])) as Array<{ grant: string }>).map(
    (row) => row.grant,
  );

/** Whether the role exists yet: before it does, `regrole` can't name it. */
const exists = async (sql: Statements): Promise<boolean> =>
  (
    (await sql.unsafe("SELECT 1 FROM pg_roles WHERE rolname = $1", [
      STUDIO,
    ])) as unknown[]
  ).length > 0;

/** Lines in `to` and not `from`, as `+ line`, then the reverse, as `- line`. */
const changes = (from: ReadonlyArray<string>, to: ReadonlyArray<string>) => [
  ...to.filter((line) => !from.includes(line)).map((line) => `+ ${line}`),
  ...from.filter((line) => !to.includes(line)).map((line) => `- ${line}`),
];

const item = "allthings studio";

/** Rolls the plan's transaction back once it has shown what it would do. */
class Planned extends Error {}

/**
 * `--dry-run`: in a transaction that is always rolled back, makes the role
 * (with a throwaway password) and runs every statement, then prints what
 * would change in its privileges and where its credential would go. Nothing
 * is kept, and nothing is stored in 1Password.
 */
async function plan(owner: string, vault: string): Promise<void> {
  const sql = new Bun.SQL(owner);
  try {
    await sql.begin(async (transaction) => {
      const before = (await exists(transaction))
        ? await granted(transaction)
        : [];
      const isNew = await provisionLoginRole(
        transaction,
        STUDIO,
        newPassword(),
      );
      for (const statement of grantStatements()) {
        await transaction.unsafe(statement);
      }
      const after = await granted(transaction);
      const expected = expectedPrivileges();
      if (changes(after, expected).length > 0) {
        throw new Error(
          `The statements would leave ${STUDIO} with other privileges than STUDIO_GRANTS:\n${changes(after, expected).join("\n")}`,
        );
      }
      const delta = changes(before, after);
      console.log(
        [
          `${STUDIO} would be ${isNew ? "created" : "given a new password"}, with ${after.length} privileges on ${Object.keys(STUDIO_GRANTS).length} tables and 2 schemas.`,
          delta.length === 0
            ? "Its privileges would stay as they are."
            : `Its privileges would change:\n${delta.join("\n")}`,
          `Settings: ${Object.entries(STUDIO_SETTINGS)
            .map(([name, value]) => `${name}=${value}`)
            .join(", ")}.`,
          `Its connection string would go to 1Password, "${item}" (credential) in ${vault}, and nowhere else.`,
          "Nothing was changed. Run it again with --apply to do it.",
        ].join("\n"),
      );
      throw new Planned();
    });
  } catch (error) {
    if (!(error instanceof Planned)) throw error;
  } finally {
    await sql.end();
  }
}

/**
 * `--apply`: makes the role or gives it a new password, grants exactly
 * STUDIO_GRANTS, stores its connection string in 1Password, and then checks
 * both: the catalog holds exactly the expected privileges, and the stored
 * connection string signs in as the studio. Nothing it reads or stores is
 * printed.
 */
async function apply(owner: string, vault: string): Promise<void> {
  const password = newPassword();
  const sql = new Bun.SQL(owner);
  let created: boolean;
  try {
    created = await sql.begin(async (transaction) => {
      const isNew = await provisionLoginRole(transaction, STUDIO, password);
      for (const statement of grantStatements()) {
        await transaction.unsafe(statement);
      }
      return isNew;
    });
    const wrong = changes(await granted(sql), expectedPrivileges());
    if (wrong.length > 0) {
      throw new Error(
        `${STUDIO}'s privileges aren't STUDIO_GRANTS after the grants:\n${wrong.join("\n")}`,
      );
    }
  } finally {
    // A refused transaction changed nothing; the client closes either way.
    await sql.end();
  }

  try {
    await storeItem({
      value: connectionStringFor(owner, STUDIO, password),
      item,
      vault,
      notes:
        "The event studio's connection to production (core's README, \"The studio's connection\"). Rotate with infra/scripts/studio.ts in allthingsweb-dev/allthingsweb.",
    });
  } catch (cause) {
    throw new Error(
      `The role's password has changed, but 1Password ("${item}" in ${vault}) may still hold the old one: ${cause instanceof Error ? cause.message : String(cause)}. Rerun this script once 1Password answers.`,
      { cause },
    );
  }

  // Read back what 1Password now holds, and sign in with it.
  const stored = (
    await run(["op", "read", ["op:/", vault, item, "credential"].join("/")])
  ).trim();
  const studio = new Bun.SQL(stored);
  try {
    const [row] = (await studio.unsafe("SELECT current_user AS who")) as Array<{
      who: string;
    }>;
    if (row?.who !== STUDIO) {
      throw new Error(`1Password's "${item}" signs in as someone else`);
    }
  } finally {
    await studio.end();
  }
  console.log(
    `✓ ${STUDIO} ${created ? "created" : "has a new password"}, exactly STUDIO_GRANTS on ${Object.keys(STUDIO_GRANTS).length} tables; 1Password ("${item}" in ${vault}) updated, and it signs in as ${STUDIO}`,
  );
}

/** Plans (--dry-run) or applies (--apply) the role on the database at OWNER_URL. */
async function main(): Promise<void> {
  const owner = process.env["OWNER_URL"];
  if (!owner) throw new Error("OWNER_URL is required (see this file's header)");
  const vault = process.env["VAULT"] ?? "allthings";
  const mode = process.argv.slice(2);
  if (mode.length === 1 && mode[0] === "--dry-run") return plan(owner, vault);
  if (mode.length === 1 && mode[0] === "--apply") return apply(owner, vault);
  throw new Error(
    "Pass --dry-run to see what it would do, then --apply to do it (see this file's header).",
  );
}

if (import.meta.main) await main();
