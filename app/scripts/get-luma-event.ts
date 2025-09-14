import { getLumaEvent } from "./functions";

const lumaEventId = "evt-TI4Rc7MwnlmlrvP";

async function main() {
  try {
    const lumaEvent = await getLumaEvent(lumaEventId);
    console.log("Luma Event Data:");
    console.log(JSON.stringify(lumaEvent, null, 2));
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
}

main();
