import { buildContainer } from "~/modules/container.server";
import { eventsTable, InsertEvent } from "@lib/db/schema.server";

// 0a27defe-abf3-4db9-8feb-4a547ef2ef18
const event = {
  name: "All Things Web Hack Evening",
  slug: "2025-12-03-all-things-web-hack-evening",
  attendeeLimit: 40,
  tagline:
    "Join us for our first Hack Evening. Hack into the evening and hang out with awesome people; this event is all about providing you a space to work on your favorite project and connect with the community.",
  startDate: new Date("2025-12-03T17:30:00.000Z"),
  endDate: new Date("2025-12-03T20:30:00.000Z"),
  lumaEventId: "evt-4tdtev7Ap2qLcPW",
  isDraft: false,
  isHackathon: false,
  highlightOnLandingPage: false,
  fullAddress: "620 Treat Ave, San Francisco, CA 94110, USA",
  shortLocation: "Southern Pacific Brewing",
  streetAddress: "620 Treat Ave",
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
