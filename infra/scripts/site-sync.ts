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
 *     bun infra/scripts/site-sync.ts
 *
 * VAULT names the 1Password vault (default: Private).
 */
import {
  connectionStringFor,
  newPassword,
  provisionLoginRole,
  storeConnectionString,
} from "./login-role.ts";

export const SITE_SYNC = "site_sync";

interface ColumnGrants {
  readonly select?: ReadonlyArray<string>;
  readonly insert?: ReadonlyArray<string>;
  readonly update?: ReadonlyArray<string>;
}

/**
 * The columns each table's statements read and write, from the sync's own
 * SQL: core/src/luma/sync.ts upserts events from Luma's calendar feed,
 * core/src/luma/venues.ts fills in the venues it hides from Luma's API, and
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
 *   fields.
 * - images: one row per stored image, its id made by the sync.
 * - profiles, event_posts: rows still missing an image, and the image set.
 *   Profiles also: the X follower refresh (core/src/followers.ts) reads each
 *   handle and its snapshot, and writes the new count with when it was read.
 *
 * Row locks taken while an image is claimed (FOR UPDATE) need UPDATE on the
 * table, which these grant.
 */
export const SITE_SYNC_GRANTS: Readonly<Record<string, ColumnGrants>> = {
  events: {
    select: [
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
    ],
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
      "x_followers",
      "x_followers_at",
    ],
    update: ["image", "updated_at", "x_followers", "x_followers_at"],
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
    ],
    update: ["image", "author_avatar", "updated_at"],
  },
};

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

/** The SQL that leaves `role` with exactly SITE_SYNC_GRANTS and the settings, run as the owner. */
export function grantStatements(role = SITE_SYNC): string[] {
  const statements = [
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
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

const item = "allthings site_sync";

async function main(): Promise<void> {
  const owner = process.env["OWNER_URL"];
  if (!owner) throw new Error("OWNER_URL is required (see this file's header)");
  const vault = process.env["VAULT"] ?? "Private";

  const password = newPassword();
  const sql = new Bun.SQL(owner);
  const created = await sql.begin(async (transaction) => {
    const isNew = await provisionLoginRole(transaction, SITE_SYNC, password);
    for (const statement of grantStatements()) {
      await transaction.unsafe(statement);
    }
    return isNew;
  });
  await sql.end();

  await storeConnectionString({
    value: connectionStringFor(owner, SITE_SYNC, password),
    secret: "NEON_SYNC_URL",
    item,
    vault,
    notes:
      "The hourly Luma sync's connection to production (its Worker's Hyperdrive). Rotate with infra/scripts/site-sync.ts in allthingsweb-dev/allthingsweb.",
  });
  console.log(
    `✓ ${SITE_SYNC} ${created ? "created" : "has a new password"}, column grants on ${Object.keys(SITE_SYNC_GRANTS).length} tables; NEON_SYNC_URL and 1Password ("${item}" in ${vault}) updated`,
  );
}

if (import.meta.main) await main();
