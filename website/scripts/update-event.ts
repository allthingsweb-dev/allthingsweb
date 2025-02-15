import { eq } from "drizzle-orm";
import { buildContainer } from "~/modules/container.server";
import { eventsTable, InsertEvent } from "~/modules/db/schema.server";

const slug = "2025-02-25-all-things-web-at-sentry";
const eventData = {
  highlightOnLandingPage: true,
  attendeeLimit: 200,
} satisfies Partial<InsertEvent>;

async function main() {
  const container = buildContainer();
  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }
  const res = await container.cradle.db
    .update(eventsTable)
    .set(eventData)
    .where(eq(eventsTable.id, event.id))
    .returning();
  console.log(res);
}

main();
