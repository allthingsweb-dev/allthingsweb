import { findTalksBySpeakerName } from "./functions";

const speakerName = "Ted Nyman";

async function main() {
  const { talks, talkEvents } = await findTalksBySpeakerName(speakerName);
  if (talkEvents) {
    console.log(talkEvents);
  }
  console.log(talks);
}

await main();
