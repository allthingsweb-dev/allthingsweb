import { deleteEventImages } from "./functions";

const imageUrls = [
  "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2025-09-23-lightning-hackathon-at-sentry/teams/53b7b6e1-706f-48fc-8d00-7e0e37cb1878.jpeg",
];

async function main() {
  try {
    const results = await deleteEventImages(imageUrls);
    for (const result of results) {
      console.log(
        `Deleted image with id ${result.id} for event ${result.eventName}`,
      );
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
}

main();
