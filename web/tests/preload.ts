import { migratedTemplate } from "allthings-core/tests/support/database.ts";

/**
 * Runs before any test file (bunfig.toml): makes the migrated database the
 * tests restore (see core/scripts/pglite.ts), so the first test to want one
 * doesn't spend its time limit on initdb and the migrations.
 */
await migratedTemplate();
