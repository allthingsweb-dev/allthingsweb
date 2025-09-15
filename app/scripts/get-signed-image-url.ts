#!/usr/bin/env bun

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { imagesTable } from "../src/lib/schema";
import { signImage } from "../src/lib/image-signing";

/**
 * Script to get a signed S3 URL for an image given its database ID
 *
 * Usage:
 *   bun scripts/get-signed-image-url.ts <image-id>
 *
 * Example:
 *   bun scripts/get-signed-image-url.ts 717803b9-074f-47b9-adb7-ff3f2e520eee
 */

async function getSignedImageUrl(imageId: string): Promise<void> {
  try {
    console.log(`🔍 Looking up image with ID: ${imageId}`);

    // Fetch the image from the database
    const imageResult = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.id, imageId))
      .limit(1);

    if (imageResult.length === 0) {
      console.error(`❌ No image found with ID: ${imageId}`);
      process.exit(1);
    }

    const image = imageResult[0];
    console.log(`✅ Found image:`);
    console.log(`   - URL: ${image.url}`);
    console.log(`   - Alt: ${image.alt}`);
    console.log(`   - Dimensions: ${image.width}x${image.height}`);
    console.log(`   - Created: ${image.createdAt}`);

    // Sign the image URL
    console.log(`\n🔐 Generating signed URL...`);

    const signedImage = await signImage({
      url: image.url,
      alt: image.alt,
      placeholder: image.placeholder,
      width: image.width,
      height: image.height,
    });

    console.log(`\n✨ Signed URL generated successfully!`);
    console.log(`📋 Signed URL: ${signedImage.url}`);

    // Check if the URL was actually signed (contains AWS signature parameters)
    if (signedImage.url.includes("X-Amz-Signature")) {
      console.log(`🔒 URL is properly signed and will expire in 24 hours`);
    } else if (signedImage.url.startsWith("/")) {
      console.log(`📁 This is a local/public image, no signing needed`);
    } else {
      console.log(`⚠️  URL signing may have failed or was not needed`);
    }

    // Copy to clipboard if available (macOS)
    try {
      const { spawn } = require("child_process");
      const pbcopy = spawn("pbcopy");
      pbcopy.stdin.write(signedImage.url);
      pbcopy.stdin.end();
      console.log(`📋 Signed URL copied to clipboard!`);
    } catch (error) {
      // Clipboard copy failed, but that's okay
    }
  } catch (error) {
    console.error(`❌ Error getting signed image URL:`, error);
    process.exit(1);
  }
}

// Get image ID from command line arguments
const imageId = process.argv[2];

if (!imageId) {
  console.error(`❌ Please provide an image ID as an argument`);
  console.log(`\nUsage: bun scripts/get-signed-image-url.ts <image-id>`);
  console.log(
    `Example: bun scripts/get-signed-image-url.ts 717803b9-074f-47b9-adb7-ff3f2e520eee`,
  );
  process.exit(1);
}

// Validate UUID format
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(imageId)) {
  console.error(`❌ Invalid image ID format. Expected UUID format.`);
  console.log(`Example: 717803b9-074f-47b9-adb7-ff3f2e520eee`);
  process.exit(1);
}

// Run the script
getSignedImageUrl(imageId)
  .then(() => {
    console.log(`\n✅ Script completed successfully!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`💥 Script failed:`, error);
    process.exit(1);
  });
