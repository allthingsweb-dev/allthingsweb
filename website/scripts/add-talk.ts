import { buildContainer } from "~/modules/container.server";
import { eventTalksTable } from "~/modules/db/schema.server";

const slug = "2025-03-19-all-things-web-at-convex";
const talkId = "46c0e0fe-954f-4396-9919-1b2a0a81c3c6";

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
