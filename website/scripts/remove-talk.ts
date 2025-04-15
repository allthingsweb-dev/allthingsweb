import { buildContainer } from "~/modules/container.server";
import { eventTalksTable } from "@lib/db/schema.server";
import { and, eq } from "drizzle-orm";

const slug = "2025-04-26-hackathon-at-sentry";
const talkId = "3fd184ad-a4e4-4324-bb1b-a22f00961388";
async function main() {
  const container = buildContainer();

  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    console.error("Event not found");
    return;
  }

  await container.cradle.db
    .delete(eventTalksTable)
    .where(
      and(
        eq(eventTalksTable.talkId, talkId),
        eq(eventTalksTable.eventId, event.id),
      ),
    );
  console.log("Done");
}

main();
