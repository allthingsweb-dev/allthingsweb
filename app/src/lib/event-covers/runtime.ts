import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { processImage } from "@/lib/image-processor";
import { createLumaClient } from "@/lib/luma";
import { ingestMissingCovers, type CoverIngestionResult } from "./ingest";

const maxCoverBytes = 15 * 1024 * 1024;

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Cover download failed: ${response.status}`);
  }
  if (!response.headers.get("content-type")?.startsWith("image/")) {
    throw new Error("Cover is not an image");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxCoverBytes) {
    throw new Error("Cover is larger than 15 MB");
  }
  return bytes;
}

export async function ingestMissingLumaCovers(): Promise<
  CoverIngestionResult | { skipped: string }
> {
  if (!mainConfig.luma.apiKey) {
    return { skipped: "LUMA_API_KEY is not set" };
  }
  const luma = createLumaClient();
  const s3 = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
  });

  return ingestMissingCovers({
    database: db,
    findCoverUrl: async ({ lumaEventId }) =>
      (await luma.getEvent(lumaEventId))?.event.cover_url ?? null,
    download,
    process: async (bytes) => {
      const processed = await processImage(bytes);
      return {
        bytes: processed.buffer,
        width: processed.metadata.width,
        height: processed.metadata.height,
        format: processed.metadata.format,
        placeholder: processed.placeholder,
      };
    },
    store: async (key, image) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: mainConfig.s3.bucket,
          Key: key,
          Body: image.bytes,
          ContentType: `image/${image.format}`,
        }),
      );
      return `${mainConfig.s3.url}/${key}`;
    },
    newId: randomUUID,
    now: Date.now,
  });
}
