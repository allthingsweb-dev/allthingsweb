import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { imageBucket } from "@/lib/remote-images/bucket";
import { downloadImage, processForStorage } from "@/lib/remote-images/download";
import { postImageHosts } from "./hosts";
import { ingestPostImages, type PostImageResult } from "./ingest";

export async function ingestMissingPostImages({
  budgetMs,
  signal,
}: {
  budgetMs: number;
  signal: AbortSignal;
}): Promise<PostImageResult> {
  const bucket = imageBucket();
  return ingestPostImages(
    {
      database: db,
      download: (url, options) => downloadImage(url, postImageHosts, options),
      process: processForStorage,
      store: bucket.store,
      remove: bucket.remove,
      newId: randomUUID,
      now: Date.now,
    },
    { budgetMs, signal },
  );
}
