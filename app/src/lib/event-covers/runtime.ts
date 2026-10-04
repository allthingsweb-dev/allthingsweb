import { randomUUID } from "node:crypto";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { createLumaClient } from "@/lib/luma";
import { imageBucket } from "@/lib/remote-images/bucket";
import { downloadImage, processForStorage } from "@/lib/remote-images/download";
import { coverHosts } from "./cover-source";
import { ingestMissingCovers, type CoverIngestionResult } from "./ingest";
import { findLumaCoverUrl, publicLumaCoverUrl } from "./luma-cover";

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
  const bucket = imageBucket();

  return ingestMissingCovers(
    {
      database: db,
      findCoverUrl: ({ lumaEventId }, options) =>
        findLumaCoverUrl(lumaEventId, options, {
          api: async (id, { signal }) =>
            (await luma.getEvent(id, { signal }))?.event.cover_url ?? null,
          publicData: publicLumaCoverUrl,
        }),
      download: (url, options) => downloadImage(url, coverHosts, options),
      process: processForStorage,
      store: bucket.store,
      remove: bucket.remove,
      newId: randomUUID,
      now: Date.now,
    },
    { budgetMs, signal },
  );
}
