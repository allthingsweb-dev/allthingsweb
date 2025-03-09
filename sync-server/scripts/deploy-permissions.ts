#!/usr/bin/env bun
/**
 * Script to deploy permissions using zero-deploy-permissions
 */
import { $ } from "bun";
import invariant from "tiny-invariant";

// Verify environment variables are loaded correctly
invariant(process.env.ZERO_UPSTREAM_DB, "ZERO_UPSTREAM_DB is not set");
invariant(process.env.ZERO_CVR_DB, "ZERO_CVR_DB is not set");
invariant(process.env.ZERO_CHANGE_DB, "ZERO_CHANGE_DB is not set");

try {
  console.log("Generating permissions SQL...");

  // Run zero-deploy-permissions
  await $`ZERO_UPSTREAM_DB=${process.env.ZERO_UPSTREAM_DB} \
    ZERO_CVR_DB=${process.env.ZERO_CVR_DB} \
    ZERO_CHANGE_DB=${process.env.ZERO_CHANGE_DB} \
    bunx zero-deploy-permissions \
      --schema-path='../lib/zero-sync/schema.ts' \
      --output-file='./permissions.sql'`;

  console.log("Permissions deployed successfully!");
} catch (error) {
  console.error("Error deploying permissions:", error);
  process.exit(1);
}
