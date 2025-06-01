import { buildContainer } from "~/modules/container.server";
import { eventTalksTable } from "@lib/db/schema.server";

const slug = "2025-05-28-all-things-web-at-vapi";
const talkId = "45a108cb-45d0-4908-987a-16587183f24f";
async function main() {
  const container = buildContainer();

  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    console.error("Event not found");
    return;
  }

  await container.cradle.db.insert(eventTalksTable).values({
    eventId: event.id,
    talkId,
  });
  console.log("Done");
}

main();
