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
import xFollowersMigration from "./0015_x_followers.ts";
import externalTalksMigration from "./0016_external_talks.ts";
import personSlugsMigration from "./0017_person_slugs.ts";
import pendingPostsMigration from "./0018_pending_posts.ts";
import xUserIdsMigration from "./0019_x_user_ids.ts";
import venueByOrganizerMigration from "./0020_venue_by_organizer.ts";
import sentPostsMigration from "./0021_sent_posts.ts";
import xSentPostsMigration from "./0022_x_sent_posts.ts";
import dropAdminTablesMigration from "./0023_drop_admin_tables.ts";
import draftLineupMigration from "./0024_draft_lineup.ts";
import generatedCoverMigration from "./0025_generated_cover.ts";
import draftCollaborationMigration from "./0026_draft_collaboration.ts";
import draftTalksMigration from "./0027_draft_talks.ts";
import draftLogMigration from "./0028_draft_log.ts";
import studioCollabMigration from "./0029_studio_collab.ts";
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
  "0015_x_followers": xFollowersMigration,
  "0016_external_talks": externalTalksMigration,
  "0017_person_slugs": personSlugsMigration,
  "0018_pending_posts": pendingPostsMigration,
  "0019_x_user_ids": xUserIdsMigration,
  "0020_venue_by_organizer": venueByOrganizerMigration,
  "0021_sent_posts": sentPostsMigration,
  "0022_x_sent_posts": xSentPostsMigration,
  "0023_drop_admin_tables": dropAdminTablesMigration,
  "0024_draft_lineup": draftLineupMigration,
  "0025_generated_cover": generatedCoverMigration,
  "0026_draft_collaboration": draftCollaborationMigration,
  "0027_draft_talks": draftTalksMigration,
  "0028_draft_log": draftLogMigration,
  "0029_studio_collab": studioCollabMigration,
};

/** The migrations, in id order, for the migrator. */
export const loader: Migrator.Loader = Migrator.fromRecord(migrations);
