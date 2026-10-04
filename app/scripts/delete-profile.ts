#!/usr/bin/env bun

import { deleteProfile } from "./functions";
import { db } from "../src/lib/db";
import { profilesTable } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function promptUser(question: string): Promise<boolean> {
  console.log(question);
  process.stdout.write("Type 'YES' to confirm, anything else to cancel: ");

  for await (const line of console) {
    const input = line.trim();
    return input === "YES";
  }

  return false;
}

async function main() {
  try {
    const profileId = process.argv[2];

    if (!profileId) {
      console.error("❌ Usage: bun run delete-profile.ts <profile-id>");
      console.error(
        "Example: bun run delete-profile.ts 2143f74d-de33-4248-92a2-a04a07d4367e",
      );
      process.exit(1);
    }

    console.log("🔍 Fetching profile information...");

    // Get profile details directly by ID - more precise than searching by name
    const profile = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, profileId))
      .then((profiles) => profiles[0]);

    if (!profile) {
      console.error(`❌ Profile with ID ${profileId} not found.`);
      process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🚨 DANGER: PROFILE DELETION CONFIRMATION 🚨");
    console.log("=".repeat(60));
    console.log(`Profile ID: ${profileId}`);
    console.log(`Name: ${profile.name}`);
    console.log(`Type: ${profile.profileType}`);
    console.log(`Title: ${profile.title}`);
    console.log(`Created: ${String(profile.createdAt)}`);
    if (profile.image) {
      console.log(`Image ID: ${profile.image}`);
    }

    console.log("\n⚠️  THIS ACTION WILL:");
    console.log("   • Delete the profile from the database");
    console.log("   • Delete the associated image from storage");
    console.log("   • Delete the image record from database");
    console.log("   • This action CANNOT be undone!");
    console.log("\n✅ SAFETY CHECKS:");
    console.log("   • Will abort if profile has associated talks");
    console.log("   • Will verify profile exists before deletion");

    const confirmed = await promptUser(
      "\n🔥 Are you absolutely sure you want to DELETE this profile?",
    );

    if (!confirmed) {
      console.log("\n❌ Deletion cancelled by user.");
      process.exit(0);
    }

    console.log("\n🚨 Starting deletion process...");

    const result = await deleteProfile(profileId);

    console.log("\n" + "=".repeat(60));
    console.log("✅ DELETION COMPLETED SUCCESSFULLY");
    console.log("=".repeat(60));
    console.log(result.message);

    if (result.deletedImage) {
      console.log(`🖼️  Deleted image: ${result.deletedImage.url}`);
    }

    console.log("👤 Deleted profile details:");
    console.log(`   Name: ${result.deletedProfile.name}`);
    console.log(`   Type: ${result.deletedProfile.profileType}`);
    console.log(`   ID: ${result.deletedProfile.id}`);
  } catch (error) {
    console.error("\n❌ DELETION FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (import.meta.main) {
  await main();
}
