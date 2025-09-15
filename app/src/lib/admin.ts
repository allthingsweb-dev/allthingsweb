import { eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  administratorsTable,
  profilesTable,
  profileUsersTable,
} from "./schema";
import { usersSync } from "drizzle-orm/neon";

export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const adminRecord = await db
      .select()
      .from(administratorsTable)
      .where(eq(administratorsTable.userId, userId))
      .limit(1);

    return adminRecord.length > 0;
  } catch (error) {
    console.error("Error checking admin status:", error);
    return false;
  }
}

export async function getAllProfiles() {
  return await db
    .select({
      id: profilesTable.id,
      name: profilesTable.name,
      title: profilesTable.title,
      profileType: profilesTable.profileType,
    })
    .from(profilesTable)
    .orderBy(profilesTable.name);
}

export async function getAllUsers() {
  return await db
    .select({
      id: usersSync.id,
      name: usersSync.name,
      email: usersSync.email,
    })
    .from(usersSync)
    .where(isNull(usersSync.deletedAt))
    .orderBy(usersSync.name);
}

export async function getProfileWithUser(profileId: string) {
  const result = await db
    .select({
      profile: profilesTable,
      user: {
        id: usersSync.id,
        name: usersSync.name,
        email: usersSync.email,
      },
    })
    .from(profilesTable)
    .leftJoin(
      profileUsersTable,
      eq(profilesTable.id, profileUsersTable.profileId),
    )
    .leftJoin(usersSync, eq(profileUsersTable.userId, usersSync.id))
    .where(eq(profilesTable.id, profileId))
    .limit(1);

  return result[0] || null;
}

export async function assignProfileToUser(profileId: string, userId: string) {
  // First check if profile is already assigned to someone
  const existingAssignment = await db
    .select()
    .from(profileUsersTable)
    .where(eq(profileUsersTable.profileId, profileId))
    .limit(1);

  if (existingAssignment.length > 0) {
    // Update existing assignment
    await db
      .update(profileUsersTable)
      .set({
        userId,
        updatedAt: new Date(),
      })
      .where(eq(profileUsersTable.profileId, profileId));
  } else {
    // Create new assignment
    await db.insert(profileUsersTable).values({
      profileId,
      userId,
    });
  }
}

export async function removeProfileUserAssignment(profileId: string) {
  await db
    .delete(profileUsersTable)
    .where(eq(profileUsersTable.profileId, profileId));
}
