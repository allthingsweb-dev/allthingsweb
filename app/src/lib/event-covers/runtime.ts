import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { processImage } from "@/lib/image-processor";
import { createLumaClient } from "@/lib/luma";
import { ingestMissingCovers, type CoverIngestionResult } from "./ingest";
import { fetchCover } from "./cover-source";
import { readBodyAtMost } from "./read-body";

const maxCoverBytes = 15 * 1024 * 1024;

async function download(
  url: string,
  { signal }: { signal: AbortSignal },
): Promise<Uint8Array> {
  const response = await fetchCover(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Cover download failed: ${response.status}`);
  }
  if (!response.headers.get("content-type")?.startsWith("image/")) {
    await response.body?.cancel();
    throw new Error("Cover is not an image");
  }
  return readBodyAtMost(response, maxCoverBytes);
}

export async function ingestMissingLumaCovers({
  budgetMs,
  signal,
}: {
  /** How long to keep starting new events. */
  budgetMs: number;
  /** Hard stop for the event in progress. */
  signal: AbortSignal;
}): Promise<CoverIngestionResult | { skipped: string }> {
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

  return ingestMissingCovers(
    {
      database: db,
      findCoverUrl: async ({ lumaEventId }, { signal }) =>
        (await luma.getEvent(lumaEventId, { signal }))?.event.cover_url ?? null,
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
      store: async (key, image, { signal }) => {
        await s3.send(
          new PutObjectCommand({
            Bucket: mainConfig.s3.bucket,
            Key: key,
            Body: image.bytes,
            ContentType: `image/${image.format}`,
          }),
          { abortSignal: signal },
        );
        return `${mainConfig.s3.url}/${key}`;
      },
      remove: async (key) => {
        await s3.send(
          new DeleteObjectCommand({ Bucket: mainConfig.s3.bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(5_000) },
        );
      },
      newId: randomUUID,
      now: Date.now,
    },
    { budgetMs, signal },
  );
}
