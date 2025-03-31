import { buildContainer } from "~/modules/container.server";
import {
  profilesTable,
} from "@lib/db/schema.server";
import { eq } from "drizzle-orm";

const name = "Sean Strong";
async function main() {
  const container = buildContainer();
  const db = container.cradle.db;
  const profile = await db.select().from(profilesTable).where(eq(profilesTable.name, name));
  console.log(profile);
}

main();
