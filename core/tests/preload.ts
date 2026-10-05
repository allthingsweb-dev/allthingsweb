import { migratedTemplate } from "./support/database.ts";

/**
 * Runs before any test file (bunfig.toml): makes the migrated database every
 * test restores (see scripts/pglite.ts), so the first test to want one
 * doesn't spend its time limit on initdb and the migrations.
 */
await migratedTemplate();
