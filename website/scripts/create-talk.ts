import { buildContainer } from "~/modules/container.server";
import {
  InsertTalk,
  talkSpeakersTable,
  talksTable,
} from "~/modules/db/schema.server";

const talk = {
  title: "Anti-Crash Course: Building Better Errors and Traces",
  description:
    "We've all seen apps crash with screens that tell you nothing about what's actually broken (Hi <framework>, we see you), and leave you with little to go on to figure out solving it. Lets jump in and fix that, hands on!",
} satisfies InsertTalk;

async function main() {
  const speakerId = "13368c6c-6dd0-46ca-883c-0841d480a302";
  const container = buildContainer();

  const talkRes = await container.cradle.db
    .insert(talksTable)
    .values(talk)
    .returning();
  if (!talkRes[0]) {
    console.error("Failed to create talk");
    return;
  }
  const talkSpeakerRes = await container.cradle.db
    .insert(talkSpeakersTable)
    .values({
      talkId: talkRes[0].id,
      speakerId,
    })
    .returning();
  console.log(talkSpeakerRes);
}

main();
