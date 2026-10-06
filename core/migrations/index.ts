import * as Migrator from "effect/sql/Migrator";
import baselineMigration from "./0001_baseline.ts";
import eventTopicMigration from "./0002_event_topic.ts";
import joinTableKeysMigration from "./0003_join_table_keys.ts";
import eventPeopleMigration from "./0004_event_people.ts";
import eventPostsMigration from "./0005_event_posts.ts";
import eventExtrasMigration from "./0006_event_extras.ts";
import hostLinksMigration from "./0007_host_links.ts";
import eventProgramMigration from "./0008_event_program.ts";
import eventCurationMigration from "./0009_event_curation.ts";
import hostLumaUserMigration from "./0010_host_luma_user.ts";
import eventDescriptionMigration from "./0011_event_description.ts";
import planningMigration from "./0012_planning.ts";
import shortSlugsMigration from "./0013_short_slugs.ts";
import talkOrderMigration from "./0014_talk_order.ts";
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
  "0003_join_table_keys": joinTableKeysMigration,
  "0004_event_people": eventPeopleMigration,
  "0005_event_posts": eventPostsMigration,
  "0006_event_extras": eventExtrasMigration,
  "0007_host_links": hostLinksMigration,
  "0008_event_program": eventProgramMigration,
  "0009_event_curation": eventCurationMigration,
  "0010_host_luma_user": hostLumaUserMigration,
  "0011_event_description": eventDescriptionMigration,
  "0012_planning": planningMigration,
  "0013_short_slugs": shortSlugsMigration,
  "0014_talk_order": talkOrderMigration,
};

/** The migrations, in id order, for the migrator. */
export const loader: Migrator.Loader = Migrator.fromRecord(migrations);
