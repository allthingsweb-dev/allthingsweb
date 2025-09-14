import { removeTalkFromEvent } from "./functions";

const slug = "2025-04-03-ai-x-all-things-web";
const talkId = "3fd184ad-a4e4-4324-bb1b-a22f00961388";

async function main() {
  const result = await removeTalkFromEvent(slug, talkId);
  console.log(`Deleted ${result.length} talk(s) from event`);
}

main();
