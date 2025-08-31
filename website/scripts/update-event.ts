import { InsertEvent } from "@lib/db/schema.server";
import { updateEvent } from "./functions";

const slug = "2025-06-01-nextdevfm-live";
const eventData = {
  slug: "2025-06-02-nextdevfm-live",
} satisfies Partial<InsertEvent>;

async function main() {
  const res = await updateEvent(slug, eventData);
  console.log(res);
}

main();
