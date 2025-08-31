import { addImagesToEvent } from "./functions";

const eventSlug = "2025-05-13-all-things-web-show-and-tell";

async function main() {
  try {
    const results = await addImagesToEvent(eventSlug);
    for (const image of results) {
      console.log(image);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
}

main();
