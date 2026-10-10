import { migratedTemplate } from "./support/database.ts";

/**
 * Runs before any test file (bunfig.toml).
 *
 * - Studio writes say who is writing (ALLTHINGS_ACTOR, src/planning/
 *   draft-log.ts): every test writes as "test/core", and the CLIs the tests
 *   start inherit it, unless a test says otherwise to see a write refused.
 * - Makes the migrated database every test restores (see scripts/pglite.ts),
 *   so the first test to want one doesn't spend its time limit on initdb and
 *   the migrations.
 */
process.env["ALLTHINGS_ACTOR"] = "test/core";
await migratedTemplate();
