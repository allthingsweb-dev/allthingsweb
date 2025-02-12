import { buildContainer } from "~/modules/container.server";
import {
  InsertTalk,
  talkSpeakersTable,
  talksTable,
} from "~/modules/db/schema.server";

const talk = {
  title: "Image optimization from scratch!",
  description:
    "One of the best ways to learn something is to try and build it from scratch. That's what I've attempted last year with image optimization. Instead of picking a third-party service, I built one from scratch... and open-sourced it! In this talk, we will live-code a simple image optimization HTTP handler and talk about the challenges I faced along the way.",
} satisfies InsertTalk;

async function main() {
  const speakerId = "9527ccf6-8056-4225-b695-cb2a6e1ea50e";
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
