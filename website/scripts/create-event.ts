import { buildContainer } from "~/modules/container.server";
import { eventsTable, InsertEvent } from "~/modules/db/schema.server";

// 51802baf-8e1b-4903-99ba-96cf637bff63
const event = {
  name: "All Things Web at Convex",
  slug: "2025-03-19-all-things-web-at-convex",
  attendeeLimit: 150,
  tagline:
    "Join us for our next meetup at Convex! RSVP for two great tech talks, snacks & drinks, and plenty of time to chat about all things web.",
  startDate: new Date("2025-03-19T17:00:00.000Z"),
  endDate: new Date("2025-03-19T20:30:00.000Z"),
  lumaEventId: "evt-xWl1tkPwl1b8zbI",
  isDraft: true,
  isHackathon: false,
  highlightOnLandingPage: true,
  fullAddress: "444 De Haro St #218, San Francisco, CA 94103",
  shortLocation: "Convex HQ",
  streetAddress: "444 De Haro St #218",
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
