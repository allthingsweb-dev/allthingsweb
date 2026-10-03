import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { imageBucket } from "@/lib/remote-images/bucket";
import { downloadImage, processForStorage } from "@/lib/remote-images/download";
import { profilePhotoHosts } from "./hosts";
import { ingestProfilePhotos, type ProfilePhotoResult } from "./ingest";

export async function ingestMissingProfilePhotos({
  budgetMs,
  signal,
}: {
  budgetMs: number;
  signal: AbortSignal;
}): Promise<ProfilePhotoResult> {
  const bucket = imageBucket();
  return ingestProfilePhotos(
    {
      database: db,
      download: (url, options) =>
        downloadImage(url, profilePhotoHosts, options),
      process: processForStorage,
      store: bucket.store,
      remove: bucket.remove,
      newId: randomUUID,
      now: Date.now,
    },
    { budgetMs, signal },
  );
}
