import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { appMediaStore } from "./index";
import { copyLegacyImages, type LegacyCopyResult } from "./copy-legacy";

/** Copies the next legacy S3 images into R2 within the given budget. */
export async function copyLegacyS3Images({
  budgetMs,
  signal,
}: {
  budgetMs: number;
  signal: AbortSignal;
}): Promise<LegacyCopyResult> {
  const s3 = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
  });
  return copyLegacyImages(
    {
      database: db,
      legacyOrigin: mainConfig.s3.url,
      read: async (key, { signal: abortSignal }) => {
        try {
          const object = await s3.send(
            new GetObjectCommand({ Bucket: mainConfig.s3.bucket, Key: key }),
            { abortSignal },
          );
          if (!object.Body) return null;
          return {
            body: await object.Body.transformToByteArray(),
            contentType: object.ContentType,
          };
        } catch (error) {
          if (error instanceof NoSuchKey) return null;
          throw error;
        }
      },
      store: appMediaStore(),
      now: Date.now,
    },
    { budgetMs, signal },
  );
}
