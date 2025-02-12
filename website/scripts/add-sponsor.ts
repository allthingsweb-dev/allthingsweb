import { eq } from "drizzle-orm";
import { buildContainer } from "~/modules/container.server";
import {
  eventSponsorsTable,
  sponsorsTable,
} from "~/modules/db/schema.server";

const slug = "2025-03-19-all-things-web-at-convex";
const sponsorName = "Convex";

async function main() {
  const container = buildContainer();

  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    console.error("Event not found");
    return;
  }

  const sponsors = await container.cradle.db
    .select()
    .from(sponsorsTable)
    .where(eq(sponsorsTable.name, sponsorName));
  if (sponsors.length !== 1) {
    console.error("Sponsor not found");
    return;
  }

  await container.cradle.db.insert(eventSponsorsTable).values({
    eventId: event.id,
    sponsorId: sponsors[0].id,
  });
  console.log("Done");
}

main();
