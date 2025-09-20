#!/usr/bin/env bun

import { listAwards } from "./functions";

const eventId = process.argv[2];

if (!eventId) {
  console.error("Usage: bun run list-awards.ts <eventId>");
  console.error(
    "Example: bun run list-awards.ts 123e4567-e89b-12d3-a456-426614174000",
  );
  process.exit(1);
}

try {
  const result = await listAwards(eventId);

  console.log(`\n🏆 Awards for event: ${result.event.name}`);
  console.log(`📊 Total awards: ${result.count}\n`);

  if (result.awards.length === 0) {
    console.log("No awards found for this event.");
  } else {
    result.awards.forEach((award, index) => {
      console.log(`${index + 1}. ${award.name}`);
      console.log(`   ID: ${award.id}`);
      console.log(`   Created: ${new Date(award.createdAt).toLocaleString()}`);
      console.log("");
    });
  }
} catch (error) {
  console.error("\n❌ Failed to list awards:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
