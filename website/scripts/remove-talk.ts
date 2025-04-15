import { buildContainer } from "~/modules/container.server";
import { eventTalksTable } from "@lib/db/schema.server";
import { and, eq } from "drizzle-orm";

const slug = "2025-04-03-ai-x-all-things-web";
const talkId = "3fd184ad-a4e4-4324-bb1b-a22f00961388";
async function main() {
  const container = buildContainer();

  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    console.error("Event not found");
    return;
  }

  const result = await container.cradle.db
    .delete(eventTalksTable)
    .where(
      and(
        eq(eventTalksTable.talkId, talkId),
        eq(eventTalksTable.eventId, event.id),
      ),
    )
    .returning();
  console.log(`Deleted ${result.length} talk(s) from event`);
}

main();
