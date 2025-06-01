import { buildContainer } from "~/modules/container.server";
import {
  talkSpeakersTable,
  talksTable,
  profilesTable,
  eventTalksTable,
  eventsTable,
} from "@lib/db/schema.server";
import { eq } from "drizzle-orm";

const speakerName = "Ted Nyman";

async function main() {
  const container = buildContainer();
  const db = container.cradle.db;
  const [speaker] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, speakerName));
  const talks = await db
    .select()
    .from(talkSpeakersTable)
    .leftJoin(talksTable, eq(talkSpeakersTable.talkId, talksTable.id))
    .where(eq(talkSpeakersTable.speakerId, speaker.id));
  if (talks[0]?.talks) {
    const talkEvents = await db
      .select()
      .from(eventTalksTable)
      .leftJoin(eventsTable, eq(eventTalksTable.eventId, eventsTable.id))
      .where(eq(eventTalksTable.talkId, talks[0].talks?.id));
    console.log(talkEvents);
  }
  console.log(talks);
}

main();
