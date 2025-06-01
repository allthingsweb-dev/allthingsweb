import { buildContainer } from "~/modules/container.server";
import { eventsTable, InsertEvent } from "@lib/db/schema.server";

// 0a27defe-abf3-4db9-8feb-4a547ef2ef18
const event = {
  name: "NextDev.fm Live",
  slug: "2025-06-01-nextdevfm-live",
  attendeeLimit: 160,
  tagline: "Join us for a live episode of NextDev.fm! 🎙️",
  startDate: new Date("2025-06-01T10:30:00.000Z"),
  endDate: new Date("2025-06-01T20:30:00.000Z"),
  lumaEventId: "evt-YgL8QkcPVOTymoN",
  isDraft: false,
  isHackathon: false,
  highlightOnLandingPage: true,
  fullAddress: "1242 Market St, San Francisco, CA 94102",
  shortLocation: "SF Nook",
  streetAddress: "1242 Market St",
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
