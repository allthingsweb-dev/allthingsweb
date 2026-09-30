import { db } from "@/lib/db";
import { usersSyncTable } from "@/lib/schema";
import { isNull } from "drizzle-orm";

export type UserLookup = {
  id: string;
  name: string | null;
};

/**
 * Fetch all active users for lookup purposes
 * Returns a map of userId -> userName for efficient lookups
 */
export async function getUserLookupMap(): Promise<Map<string, string | null>> {
  const users = await db
    .select({
      id: usersSyncTable.id,
      name: usersSyncTable.name,
    })
    .from(usersSyncTable)
    .where(isNull(usersSyncTable.deletedAt));

  const userMap = new Map<string, string | null>();
  for (const user of users) {
    userMap.set(user.id, user.name);
  }

  return userMap;
}

/**
 * Fetch all active users as an array for lookup purposes
 */
export async function getUserLookupArray(): Promise<UserLookup[]> {
  const users = await db
    .select({
      id: usersSyncTable.id,
      name: usersSyncTable.name,
    })
    .from(usersSyncTable)
    .where(isNull(usersSyncTable.deletedAt));

  return users;
}
