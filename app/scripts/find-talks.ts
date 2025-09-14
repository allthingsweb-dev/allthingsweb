import { findTalksBySpeakerName } from "./functions";

const speakerName = "Ted Nyman";

async function main() {
  const { speaker, talks, talkEvents } =
    await findTalksBySpeakerName(speakerName);
  if (talkEvents) {
    console.log(talkEvents);
  }
  console.log(talks);
}

main();
