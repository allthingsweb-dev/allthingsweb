#!/usr/bin/env bun

import { createAward } from "./functions";

const eventId = process.argv[2];
const name = process.argv[3];

if (!eventId || !name) {
  console.error("Usage: bun run create-award.ts <eventId> <name>");
  console.error(
    "Example: bun run create-award.ts 123e4567-e89b-12d3-a456-426614174000 'Best Innovation'",
  );
  process.exit(1);
}

try {
  const result = await createAward({
    eventId,
    name,
  });

  console.log("\n🎉 Award creation completed!");
  console.log("Award:", result.award);
  console.log("Event:", result.event.name);
} catch (error) {
  console.error("\n❌ Failed to create award:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
