import { addSponsorToEvent } from "./functions";

const slug = "2025-06-01-nextdevfm-live";
const sponsorName = "Neon";

async function main() {
  await addSponsorToEvent(slug, sponsorName);
  console.log("Done");
}

main();
