import * as Migrator from "effect/sql/Migrator";
import baselineMigration from "./0001_baseline.ts";
import eventTopicMigration from "./0002_event_topic.ts";
import type { Migration } from "./statements.ts";

/**
 * Every migration, keyed `<id>_<name>` as its file is named. Imported
 * statically rather than read from disk, so the same list runs in Bun, in a
 * bundled Worker and from the CLI. tests/migrations.test.ts checks that it
 * names each file in this directory, with ids 1, 2, 3 and so on.
 */
export const migrations: Readonly<Record<string, Migration>> = {
  "0001_baseline": baselineMigration,
  "0002_event_topic": eventTopicMigration,
};

/** The migrations, in id order, for the migrator. */
export const loader: Migrator.Loader = Migrator.fromRecord(migrations);
