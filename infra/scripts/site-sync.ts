/**
 * Creates site_sync, or gives it a new password: the login role the hourly
 * Luma sync writes production as, from a Worker through its own Hyperdrive.
 * It holds exactly the column privileges that sync's statements need
 * (SITE_SYNC_GRANTS) and nothing else: no DELETE anywhere, no table it
 * doesn't touch, no column it doesn't read or write. Every run revokes what
 * the role holds before granting, so a narrower list here narrows the role.
 *
 * core/tests/site-sync.test.ts runs the sync as this role on a copy of the
 * schema, and checks that everything outside these grants is refused.
 *
 * Like site_reader it is created with SQL by the database owner, never in
 * Neon's console or API, because roles made there join neon_superuser. The
 * connection string goes straight into the repository's NEON_SYNC_URL secret
 * and a 1Password item; it is never printed. Run it from the repository root
 * with the owner's connection string in the environment, passed without
 * printing it:
 *
 *   OWNER_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
 *     --project-id wispy-sea-75401301 --role-name neondb_owner --database-name neondb) \
 *     bun infra/scripts/site-sync.ts --dry-run   # how its privileges would change; keeps nothing
 *   … bun infra/scripts/site-sync.ts             # do it: grants checked against the list before commit
 *
 * VAULT names the 1Password vault (default: allthings, the one vault this
 * repository reads its credentials from, and the only one agents' service
 * account can read).
 */
import {
  connectionStringFor,
  newPassword,
  provisionLoginRole,
  type Statements,
  storeConnectionString,
} from "./login-role.ts";
import { grantedQuery } from "./studio.ts";

export const SITE_SYNC = "site_sync";

interface ColumnGrants {
  readonly select?: ReadonlyArray<string>;
  readonly insert?: ReadonlyArray<string>;
  readonly update?: ReadonlyArray<string>;
}

/**
 * The columns each table's statements read and write, from the sync's own
 * SQL: core/src/luma/sync.ts upserts events from Luma's calendar feed,
 * core/src/luma/venues.ts fills in the venues it hides from Luma's API,
 * core/src/luma/descriptions.ts writes their descriptions from it,
 * core/src/slugs.ts gives evenings their short links, and
 * image ingestion (app/src/lib/{event-covers,profile-photos,post-images},
 * whose statements the Worker keeps) stores each missing event cover, profile photo and post
 * image, then points its row at the new `images` row.
 *
 * - events: the upsert inserts these columns (the id is the table's default)
 *   and on conflict updates the feed's fields when they differ, reading the
 *   stored ones to compare, and returns each event's slug. Reading
 *   `excluded.updated_at` counts as reading the column, so it is selectable.
 *   Covers read events without one and set `preview_image`. The venue fill
 *   reads published events without a venue and writes the three venue
 *   fields. The description import (core/src/luma/descriptions.ts) reads
 *   published events with a Luma id and writes Luma's description and its
 *   summary. Short links read published evenings without one (with what
 *   the rule reads: name, topic, curation, start) and every slug taken,
 *   then set `short_slug`.
 *   Both the upsert and the venue fill read `venue_by_organizer`, and leave
 *   alone a venue the organizers set.
 * - event_slugs: every link given, read to know which are taken, and one
 *   row for each link given.
 * - images: one row per stored image, its id made by the sync.
 * - profiles, event_posts: rows still missing an image, and the image set.
 * - The post search (core/src/posts/candidates.ts) reads each recent
 *   evening's name, topic, hosts and the handles of its people, and the
 *   posts already stored. It adds what it finds only through
 *   `public.queue_event_post` (SITE_SYNC_FUNCTIONS), which inserts pending
 *   posts and nothing else: a column grant can't limit a value, so the role
 *   holds no INSERT on event_posts.
 *   Profiles also: the X follower refresh (core/src/followers.ts) reads each
 *   handle, its account's id and its snapshot, and writes the new count with
 *   when it was read and the account's id. It writes the handle only for
 *   the account the profile already has: a renamed account's new handle, or
 *   none, with the lost one recorded, when X gives the handle to another.
 *
 * - event_sponsors, sponsors: the company hosts step
 *   (core/src/luma/company-hosts.ts) reads recent evenings, the hosting
 *   companies with a Luma account on record, the Luma accounts profiles
 *   hold, and the companies already attached to those evenings, then
 *   attaches each company Luma lists as a host, never replacing a row
 *   (ON CONFLICT DO NOTHING) and never removing one.
 *
 * - community_metrics: the daily snapshot of the community's public numbers
 *   (core/src/community-metrics.ts) reads which sources the day has and
 *   inserts a row per metric for each one it reads, never replacing one
 *   (ON CONFLICT DO NOTHING); to sum Luma's guests it reads the events'
 *   guest and check-in counts.
 * - community_gaps: the snapshot's gaps, a source not read for a known,
 *   temporary reason: it inserts a row per day and source, and on each
 *   later try that day updates its reason, tries and latest try, reading
 *   the key to find a source's first gap.
 *
 * Row locks taken while an image is claimed (FOR UPDATE) need UPDATE on the
 * table, which these grant.
 */
export const SITE_SYNC_GRANTS: Readonly<Record<string, ColumnGrants>> = {
  events: {
    select: [
      // The community snapshot sums Luma's guests (core/src/community-metrics.ts).
      "luma_guest_count",
      "luma_checked_in_count",
      "id",
      "luma_event_id",
      "slug",
      "name",
      "start_date",
      "end_date",
      "is_draft",
      "street_address",
      "short_location",
      "full_address",
      "preview_image",
      "updated_at",
      "luma_description",
      "luma_summary",
      "topic",
      "curation",
      "short_slug",
      "venue_by_organizer",
    ],
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
      "created_at",
      "updated_at",
    ],
    update: [
      "name",
      "start_date",
      "end_date",
      "is_draft",
      "street_address",
      "short_location",
      "full_address",
      "preview_image",
      "updated_at",
      "luma_description",
      "luma_summary",
      "short_slug",
    ],
  },
  event_slugs: {
    select: ["slug", "event_id"],
    insert: ["slug", "event_id", "created_at"],
  },
  images: {
    select: ["id"],
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
  },
  profiles: {
    select: [
      "id",
      "name",
      "photo_source_url",
      "image",
      "created_at",
      "twitter_handle",
      "bluesky_handle",
      "x_followers",
      "x_followers_at",
      "x_followers_tried_at",
      "x_user_id",
      // The company hosts step tells people from unknown Luma accounts.
      "luma_user_id",
    ],
    update: [
      "image",
      "updated_at",
      "x_followers",
      "x_followers_at",
      "x_followers_tried_at",
      "twitter_handle",
      "x_user_id",
      "x_handle_lost",
      "x_handle_lost_at",
    ],
  },
  event_posts: {
    select: [
      "id",
      "author_name",
      "image_source_url",
      "author_avatar_source_url",
      "image",
      "author_avatar",
      "added_at",
      "event_id",
      "url",
      "status",
    ],
    update: ["image", "author_avatar", "updated_at"],
  },
  event_sponsors: {
    select: ["event_id", "sponsor_id", "created_at"],
    // The company hosts step attaches the companies Luma lists.
    insert: ["event_id", "sponsor_id", "created_at", "updated_at"],
  },
  sponsors: { select: ["id", "name", "luma_user_id"] },
  event_people: { select: ["event_id", "profile_id"] },
  event_talks: { select: ["event_id", "talk_id"] },
  talk_speakers: { select: ["talk_id", "speaker_id"] },
  // The community snapshot: which sources today has, and today's rows
  // (core/src/community-metrics.ts). `read_at` takes its default.
  community_metrics: {
    select: ["day", "source", "metric"],
    insert: ["day", "source", "metric", "value"],
  },
  // The snapshot's gaps (core/src/community-metrics.ts): a row per day and
  // source, its reason and tries updated on each try; `tries` read to count
  // them, the key to find a source's first gap.
  community_gaps: {
    select: ["day", "source", "tries"],
    insert: ["day", "source", "reason", "first_at", "last_at"],
    update: ["reason", "tries", "last_at"],
  },
};

/**
 * The functions the role may execute, by signature: queuing a found post
 * as pending (core/migrations/0018_pending_posts.ts), which runs as its
 * owner and checks every field. Every other function's EXECUTE is revoked.
 */
export const SITE_SYNC_FUNCTIONS: ReadonlyArray<string> = [
  "public.queue_event_post(text, text, text, text, text, text, text, timestamptz, text, text)",
];

/**
 * Bounds on every session: a statement that runs away, a lock it waits on,
 * or a transaction left open by a Worker that died can't hold production up.
 */
export const SITE_SYNC_SETTINGS = {
  statement_timeout: "30s",
  lock_timeout: "5s",
  idle_in_transaction_session_timeout: "30s",
} as const;

const quoted = (columns: ReadonlyArray<string>) =>
  columns.map((column) => `"${column}"`).join(", ");

/** The SQL that leaves `role` with exactly SITE_SYNC_GRANTS, SITE_SYNC_FUNCTIONS and the settings, run as the owner. */
export function grantStatements(role = SITE_SYNC): string[] {
  const statements = [
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    ...SITE_SYNC_FUNCTIONS.map(
      (signature) => `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`,
    ),
  ];
  for (const [table, grants] of Object.entries(SITE_SYNC_GRANTS)) {
    for (const privilege of ["select", "insert", "update"] as const) {
      const columns = grants[privilege];
      if (columns !== undefined && columns.length > 0) {
        statements.push(
          `GRANT ${privilege.toUpperCase()} (${quoted(columns)}) ON public."${table}" TO ${role}`,
        );
      }
    }
  }
  for (const [name, value] of Object.entries(SITE_SYNC_SETTINGS)) {
    statements.push(`ALTER ROLE ${role} SET ${name} = '${value}'`);
  }
  return statements;
}

/** What {@link grantedQuery} reads once {@link grantStatements} has run: SITE_SYNC_GRANTS, line by line. */
export function expectedPrivileges(): string[] {
  return [
    "schema public usage",
    ...Object.entries(SITE_SYNC_GRANTS).flatMap(([table, grants]) =>
      (["select", "insert", "update"] as const).flatMap((privilege) =>
        (grants[privilege] ?? []).map(
          (column) => `public.${table} ${privilege} ${column}`,
        ),
      ),
    ),
  ].toSorted();
}

/** The role's table, column and schema privileges, as the catalog holds them. */
const granted = async (sql: Statements, role: string): Promise<string[]> =>
  ((await sql.unsafe(grantedQuery, [role])) as Array<{ grant: string }>).map(
    (row) => row.grant,
  );

/** Lines in `to` and not `from`, as `+ line`, then the reverse, as `- line`. */
const changes = (from: ReadonlyArray<string>, to: ReadonlyArray<string>) => [
  ...to.filter((line) => !from.includes(line)).map((line) => `+ ${line}`),
  ...from.filter((line) => !to.includes(line)).map((line) => `- ${line}`),
];

/**
 * Makes `role` (or gives it `password`) and runs {@link grantStatements} on
 * `sql`, a transaction: how its privileges change, and where they would
 * differ from SITE_SYNC_GRANTS (nothing, unless the list and its statements
 * disagree). The caller commits, or rolls back to keep nothing.
 */
export async function regrant(
  sql: Statements,
  password: string,
  role = SITE_SYNC,
): Promise<{
  readonly created: boolean;
  readonly delta: ReadonlyArray<string>;
  readonly wrong: ReadonlyArray<string>;
}> {
  const existed =
    (
      (await sql.unsafe("SELECT 1 FROM pg_roles WHERE rolname = $1", [
        role,
      ])) as unknown[]
    ).length > 0;
  const before = existed ? await granted(sql, role) : [];
  const created = await provisionLoginRole(sql, role, password);
  for (const statement of grantStatements(role)) {
    await sql.unsafe(statement);
  }
  const after = await granted(sql, role);
  return {
    created,
    delta: changes(before, after),
    wrong: changes(after, expectedPrivileges()),
  };
}

const item = "allthings site_sync";

/** Rolls the plan's transaction back once it has shown what it would do. */
class Planned extends Error {}

/**
 * `--dry-run`: in a transaction that is always rolled back, makes the role
 * (with a throwaway password) and runs every statement, then prints how its
 * privileges would change. Nothing is kept or stored.
 */
async function plan(owner: string, vault: string): Promise<void> {
  const sql = new Bun.SQL(owner);
  try {
    await sql.begin(async (transaction) => {
      const { created, delta, wrong } = await regrant(
        transaction,
        newPassword(),
      );
      if (wrong.length > 0) {
        throw new Error(
          `The statements would leave ${SITE_SYNC} with other privileges than SITE_SYNC_GRANTS:\n${wrong.join("\n")}`,
        );
      }
      console.log(
        [
          `${SITE_SYNC} would be ${created ? "created" : "given a new password"}, with column grants on ${Object.keys(SITE_SYNC_GRANTS).length} tables.`,
          delta.length === 0
            ? "Its privileges would stay as they are."
            : `Its privileges would change:\n${delta.join("\n")}`,
          `Its connection string would go to NEON_SYNC_URL and 1Password, "${item}" (credential) in ${vault}.`,
          "Nothing was changed. Run it again without --dry-run to do it.",
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
 * Without flags: makes site_sync or gives it a new password, grants it
 * exactly SITE_SYNC_GRANTS (checked before the commit), and stores its
 * connection string. `--dry-run` shows the change and keeps nothing.
 */
async function main(): Promise<void> {
  const owner = process.env["OWNER_URL"];
  if (!owner) throw new Error("OWNER_URL is required (see this file's header)");
  const vault = process.env["VAULT"] ?? "allthings";
  if (process.argv.includes("--dry-run")) return plan(owner, vault);

  const password = newPassword();
  const sql = new Bun.SQL(owner);
  let created: boolean;
  try {
    created = await sql.begin(async (transaction) => {
      const result = await regrant(transaction, password);
      // Checked before the commit: a mismatch rolls the grants and the new
      // password back, and leaves the role as it was.
      if (result.wrong.length > 0) {
        throw new Error(
          `${SITE_SYNC}'s privileges wouldn't be SITE_SYNC_GRANTS, so nothing was changed:\n${result.wrong.join("\n")}`,
        );
      }
      return result.created;
    });
  } finally {
    await sql.end();
  }

  await storeConnectionString({
    value: connectionStringFor(owner, SITE_SYNC, password),
    secret: "NEON_SYNC_URL",
    item,
    vault,
    notes:
      "The hourly Luma sync's connection to production (its Worker's Hyperdrive). Rotate with infra/scripts/site-sync.ts in allthings-sf/allthings.",
  });
  console.log(
    `✓ ${SITE_SYNC} ${created ? "created" : "has a new password"}, exactly SITE_SYNC_GRANTS on ${Object.keys(SITE_SYNC_GRANTS).length} tables; NEON_SYNC_URL and 1Password ("${item}" in ${vault}) updated`,
  );
}

if (import.meta.main) await main();
