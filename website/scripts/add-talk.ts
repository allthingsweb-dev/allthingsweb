import { buildContainer } from "~/modules/container.server";
import { eventTalksTable } from "@lib/db/schema.server";

const slug = "2025-02-25-all-things-web-at-sentry";
const talkId = "b8ef3673-71d6-4434-9551-a940cd5642ec";

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
