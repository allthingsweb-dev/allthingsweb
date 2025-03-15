import { buildContainer } from "~/modules/container.server";
import { eventsTable, InsertEvent } from "@lib/db/schema.server";

// 0a27defe-abf3-4db9-8feb-4a547ef2ef18
const event = {
  name: "Future of Web Hackathon",
  slug: "2025-04-26-hackathon-at-sentry",
  attendeeLimit: 300,
  tagline:
    "​​Join us for a day of hacking the web! Collaborate, create, and compete for two awards while bringing your ideas to life!",
  startDate: new Date("2025-04-26T10:30:00.000Z"),
  endDate: new Date("2025-04-26T20:30:00.000Z"),
  lumaEventId: "evt-qObtKnNENF3bDio",
  isDraft: true,
  isHackathon: true,
  highlightOnLandingPage: false,
  fullAddress: "45 Fremont St, San Francisco, CA 94105",
  shortLocation: "Sentry, SF",
  streetAddress: "45 Fremont St",
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
