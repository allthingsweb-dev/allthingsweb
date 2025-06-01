import { buildContainer } from "~/modules/container.server";
import {
  InsertTalk,
  talkSpeakersTable,
  talksTable,
} from "@lib/db/schema.server";

const talk = {
  title: "Performance optimizing agent for Next.js",
  description:
    "In this talk, Lee Robinson will be talking about the performance optimizing agent for Next.js and evals for better code generation.",
} satisfies InsertTalk;

async function main() {
  const speakerIds = ["8830e0cb-0989-4814-b9f5-0fbcb212fdf4"];
  const container = buildContainer();

  const talkRes = await container.cradle.db
    .insert(talksTable)
    .values(talk)
    .returning();
  if (!talkRes[0]) {
    console.error("Failed to create talk");
    return;
  }
  for (const speakerId of speakerIds) {
    const talkSpeakerRes = await container.cradle.db
      .insert(talkSpeakersTable)
      .values({
        talkId: talkRes[0].id,
        speakerId,
      })
      .returning();
    console.log(talkSpeakerRes);
  }
}

main();
