import { buildContainer } from "~/modules/container.server";
import {
  InsertTalk,
  talkSpeakersTable,
  talksTable,
} from "@lib/db/schema.server";

const talk = {
  title: "​The Agent-First Bet: How Windsurf Hit 500K Users in 3 Months",
  description:
    "In this lightning talk, Akshat will share how Windsurf hit 500K users in 3 months by placing agents at the center of their product.",
} satisfies InsertTalk;

async function main() {
  const speakerId = "d96f0e84-c3cf-452e-8d75-5b61695deebb";
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
