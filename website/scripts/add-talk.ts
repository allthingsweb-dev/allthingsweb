import { buildContainer } from "~/modules/container.server";
import { eventTalksTable } from "@lib/db/schema.server";

const slug = "2025-04-03-ai-x-all-things-web";
const talkId = "14f2e300-f2ae-4311-a229-3f2f9b56990a";
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
