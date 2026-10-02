import { InsertHost } from "../src/lib/schema";
import { createHost } from "./functions";

const darkLogoFilePath = "./scripts/logo.png";
const lightLogoFilePath = "./scripts/logo.png";
const host: InsertHost = {
  name: "Vapi",
  about:
    "Vapi is a developer platform for building, testing, and deploying voice AI agents. It provides the infrastructure for businesses and developers to create custom voice assistants that can handle call operations for existing customer support, appointment booking, and sales calls, or for building new products using voice AI like prior authorization and product onboarding assistants. Try Vapi at vapi.ai.",
};

async function main() {
  const createdHost = await createHost(
    host,
    darkLogoFilePath,
    lightLogoFilePath,
  );
  if (!createdHost) {
    console.error("Failed to create host");
    return;
  }

  console.log(createdHost.id);
}

main();
