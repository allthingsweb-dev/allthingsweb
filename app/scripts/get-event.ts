import { getEventBySlug } from "./functions";

const slug = "2024-10-05-hackathon-at-sentry";

async function main() {
  const event = await getEventBySlug(slug);
  if (!event) {
    console.error("Event not found");
    return;
  }
  console.log(event);
}

main();
