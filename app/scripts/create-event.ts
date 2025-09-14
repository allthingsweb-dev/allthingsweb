import { InsertEvent } from "../src/lib/schema";
import { createEvent } from "./functions";

const event = {
  name: "All Things Web Show & Tell",
  slug: "2025-07-23-all-things-web-show-and-tell",
  attendeeLimit: 150,
  tagline:
    "Join us for a community show & tell at the SF Nook community space!",
  startDate: new Date("2025-07-23T10:30:00.000Z"),
  endDate: new Date("2025-07-23T20:30:00.000Z"),
  lumaEventId: "evt-TI4Rc7MwnlmlrvP",
  isDraft: false,
  isHackathon: false,
  highlightOnLandingPage: true,
  fullAddress: "1242 Market St, San Francisco, CA 94102",
  shortLocation: "SF Nook",
  streetAddress: "1242 Market St",
} satisfies InsertEvent;

async function main() {
  const res = await createEvent(event);
  console.log(res);
}

main();
