import { buildContainer } from "~/modules/container.server";
import {
  InsertTalk,
  talkSpeakersTable,
  talksTable,
  profilesTable,
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
  console.log(talks);
}

main();
