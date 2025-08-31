import { deleteImages } from "./functions";

const imageUrls = [
  "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2025-03-12-all-things-web-hack-evening/3bf9ac48-17e6-4615-9522-feec3d7416de.jpeg",
  "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2025-03-12-all-things-web-hack-evening/72b4d50f-2e05-4c01-aae4-46ee29e229a3.jpeg",
  "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2025-03-12-all-things-web-hack-evening/0780be37-ec65-4b41-acba-0bcb29c65aae.jpeg",
];

async function main() {
  try {
    const results = await deleteImages(imageUrls);
    for (const result of results) {
      console.log(`Deleted image with id ${result.id} for event ${result.eventName}`);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
}

main();
