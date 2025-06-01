import { buildContainer } from "~/modules/container.server";
import { profilesTable } from "@lib/db/schema.server";
import { eq } from "drizzle-orm";

// Ryan Vogel: 2fb6b3b8-2bf7-437f-83e2-bc60ad00890a
// Dan Goosewin: 8b86e373-0709-4086-97e7-4e83102a6564
// Ted Nyman: 419b7781-718b-41cc-aa7a-a3a4a334cf74
const name = "Ted Nyman";
async function main() {
  const container = buildContainer();
  const db = container.cradle.db;
  const profile = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, name));
  console.log(profile);
}

main();
