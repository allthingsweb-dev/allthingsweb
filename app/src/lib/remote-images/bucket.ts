import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import type { StoredImage } from "./download";

/** Stores and deletes images in the app's bucket with its own credentials. */
export function imageBucket() {
  const s3 = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
  });
  return {
    store: async (
      key: string,
      image: StoredImage,
      { signal }: { signal: AbortSignal },
    ): Promise<string> => {
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
    // Runs even after cancellation, so it bounds itself.
    remove: async (key: string): Promise<void> => {
      await s3.send(
        new DeleteObjectCommand({ Bucket: mainConfig.s3.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(5_000) },
      );
    },
  };
}
