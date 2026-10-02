import { addHostToEvent } from "./functions";

const slug = "2025-06-01-nextdevfm-live";
const hostName = "Neon";

async function main() {
  await addHostToEvent(slug, hostName);
  console.log("Done");
}

main();
