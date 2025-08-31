import { InsertSponsor } from "@lib/db/schema.server";
import { createSponsor } from "./functions";

const darkLogoFilePath = "./scripts/logo.png";
const lightLogoFilePath = "./scripts/logo.png";
const sponsor: InsertSponsor = {
  name: "Vapi",
  about:
    "Vapi is a developer platform for building, testing, and deploying voice AI agents. It provides the infrastructure for businesses and developers to create custom voice assistants that can handle call operations for existing customer support, appointment booking, and sales calls, or for building new products using voice AI like prior authorization and product onboarding assistants. Try Vapi at vapi.ai.",
};

async function main() {
  const createdSponsor = await createSponsor(sponsor, darkLogoFilePath, lightLogoFilePath);
  if (!createdSponsor) {
    console.error("Failed to create sponsor");
    return;
  }

  console.log(createdSponsor.id);
}

main();
