import { buildContainer } from "~/modules/container.server";
import { eventsTable, InsertEvent } from "@lib/db/schema.server";

// 177359e8-51a7-4b13-9859-cec7083a90cf
const event = {
  name: "AI x All Things Web",
  slug: "2025-04-03-ai-x-all-things-web",
  attendeeLimit: 300,
  tagline:
    "Join us on April 3rd for a special AI x All Things Web event at the AWS GenAI Loft. We'll have several fantastic lightning talks, snacks & drinks, and plenty of time to nerd out about AI, all things web, and the future of UI!",
  startDate: new Date("2025-04-03T17:00:00.000Z"),
  endDate: new Date("2025-04-03T20:30:00.000Z"),
  lumaEventId: "evt-hMrMdGcrk8XOnuF",
  isDraft: false,
  isHackathon: false,
  highlightOnLandingPage: true,
  fullAddress: "525 Market St, San Francisco, CA 94105, USA",
  shortLocation: "AWS GenAI Loft",
  streetAddress: "525 Market St",
} satisfies InsertEvent;

async function main() {
  const container = buildContainer();
  const res = await container.cradle.db
    .insert(eventsTable)
    .values(event)
    .returning();
  console.log(res);
}

main();
