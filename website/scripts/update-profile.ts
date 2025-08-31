#!/usr/bin/env bun
import { updateProfile } from "./functions.js";

async function main() {
  const name = process.argv[2];
  const title = process.argv[3];
  const bio = process.argv[4];

  if (!name || !title || !bio) {
    console.error("Usage: bun update-profile.ts <name> <title> <bio>");
    process.exit(1);
  }

  try {
    const result = await updateProfile(name, { title, bio });
    console.log("Profile updated successfully:");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error updating profile:", error);
    process.exit(1);
  }
}

main().catch(console.error); 