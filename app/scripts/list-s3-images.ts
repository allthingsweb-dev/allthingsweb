#!/usr/bin/env bun

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { mainConfig } from "../src/lib/config";

const s3Client = new S3Client({
  region: mainConfig.s3.region,
  credentials: {
    accessKeyId: mainConfig.s3.accessKeyId,
    secretAccessKey: mainConfig.s3.secretAccessKey,
  },
});

const BUCKET_NAME = mainConfig.s3.bucket;

interface S3Object {
  key: string;
  size: number;
  lastModified: Date;
  folder: string;
  fileName: string;
}

async function listAllS3Objects(): Promise<S3Object[]> {
  const objects: S3Object[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      ContinuationToken: continuationToken,
    });

    const response = await s3Client.send(command);

    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key && object.Size !== undefined && object.LastModified) {
          // Skip folders (keys ending with /)
          if (!object.Key.endsWith("/")) {
            const pathParts = object.Key.split("/");
            const fileName = pathParts.pop() || "";
            const folder = pathParts.length > 0 ? pathParts.join("/") : "root";

            objects.push({
              key: object.Key,
              size: object.Size,
              lastModified: object.LastModified,
              folder,
              fileName,
            });
          }
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isImageFile(fileName: string): boolean {
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".bmp",
    ".tiff",
  ];
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf("."));
  return imageExtensions.includes(ext);
}

async function main() {
  console.log("🔍 Fetching S3 objects...\n");

  try {
    const objects = await listAllS3Objects();

    // Filter only image files
    const images = objects.filter((obj) => isImageFile(obj.fileName));

    if (images.length === 0) {
      console.log("📂 No images found in S3 bucket");
      return;
    }

    // Group by folder
    const folderMap = new Map<string, S3Object[]>();

    for (const image of images) {
      if (!folderMap.has(image.folder)) {
        folderMap.set(image.folder, []);
      }
      folderMap.get(image.folder)!.push(image);
    }

    // Sort folders and files
    const sortedFolders = Array.from(folderMap.keys()).sort();

    console.log(
      `📊 Found ${images.length} images across ${sortedFolders.length} folders\n`,
    );
    console.log("=".repeat(80));

    for (const folder of sortedFolders) {
      const folderImages = folderMap.get(folder)!;
      folderImages.sort((a, b) => a.fileName.localeCompare(b.fileName));

      // Calculate folder stats
      const totalSize = folderImages.reduce((sum, img) => sum + img.size, 0);

      console.log(`\n📁 /${folder}`);
      console.log(
        `   ${folderImages.length} images • ${formatFileSize(totalSize)}`,
      );
      console.log("   " + "-".repeat(60));

      for (const image of folderImages) {
        const sizeStr = formatFileSize(image.size).padEnd(8);
        const dateStr = formatDate(image.lastModified);

        console.log(`   📄 ${image.fileName.padEnd(35)} ${sizeStr} ${dateStr}`);
      }
    }

    // Summary
    const totalSize = images.reduce((sum, img) => sum + img.size, 0);
    console.log("\n" + "=".repeat(80));
    console.log(`📊 SUMMARY:`);
    console.log(`   Total Images: ${images.length}`);
    console.log(`   Total Folders: ${sortedFolders.length}`);
    console.log(`   Total Size: ${formatFileSize(totalSize)}`);
    console.log(`   S3 Bucket: ${BUCKET_NAME}`);

    // Show folder breakdown
    console.log("\n📈 FOLDER BREAKDOWN:");
    for (const folder of sortedFolders) {
      const folderImages = folderMap.get(folder)!;
      const totalSize = folderImages.reduce((sum, img) => sum + img.size, 0);
      console.log(
        `   /${folder}: ${folderImages.length} images (${formatFileSize(totalSize)})`,
      );
    }
  } catch (error) {
    console.error("❌ Error listing S3 objects:", error);
    process.exit(1);
  }
}

main().catch(console.error);
