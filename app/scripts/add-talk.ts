import { addTalkToEvent } from "./functions";

const slug = "2025-05-28-all-things-web-at-vapi";
const talkId = "45a108cb-45d0-4908-987a-16587183f24f";

async function main() {
  await addTalkToEvent(slug, talkId);
  console.log("Done");
}

main();
