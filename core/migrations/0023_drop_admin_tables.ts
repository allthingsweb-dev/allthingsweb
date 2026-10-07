import { statements } from "./statements.ts";

/**
 * The old app's admin and members' sign-in are gone (app/ no longer has
 * them), so the two tables that tied Neon Auth's users to the site go too:
 * `administrators`, who could use the admin, and `profile_users`, which
 * profile a signed-in user could edit. They were the only references from
 * the site's schemas to `neon_auth.users_sync`, so Neon Auth can be turned
 * off without breaking anything here. `neon_auth` itself is Neon's, and is
 * left alone.
 *
 * No CASCADE: if anything else came to depend on either table, this fails
 * rather than dropping it silently.
 *
 * Ships with the app's drizzle migration 0035_drop_admin_tables, which drops
 * the same two tables (with CASCADE, as drizzle writes a drop). The app's
 * drizzle schema stops declaring `neon_auth.users_sync` too; drizzle-kit
 * wrote a drop of it into 0035, taken out by hand, since `neon_auth` is
 * Neon's.
 */
export const dropAdminTables: ReadonlyArray<string> = [
  `DROP TABLE "public"."profile_users"`,
  `DROP TABLE "public"."administrators"`,
];

export default statements(dropAdminTables);
