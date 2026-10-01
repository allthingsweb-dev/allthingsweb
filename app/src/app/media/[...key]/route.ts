import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { serveMedia } from "@/lib/media";
import { imagesTable } from "@/lib/schema";

export const runtime = "nodejs";

const s3 = new S3Client({
  region: mainConfig.s3.region,
  credentials: {
    accessKeyId: mainConfig.s3.accessKeyId,
    secretAccessKey: mainConfig.s3.secretAccessKey,
  },
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  return serveMedia(key, {
    storageOrigin: mainConfig.s3.url,
    isKnownImage: async (storedUrl) => {
      const rows = await db
        .select({ id: imagesTable.id })
        .from(imagesTable)
        .where(eq(imagesTable.url, storedUrl))
        .limit(1);
      return rows.length > 0;
    },
    getObject: async (objectKey) => {
      try {
        const object = await s3.send(
          new GetObjectCommand({
            Bucket: mainConfig.s3.bucket,
            Key: objectKey,
          }),
        );
        if (!object.Body) return null;
        return {
          body: object.Body.transformToWebStream(),
          contentType: object.ContentType,
          contentLength: object.ContentLength,
          etag: object.ETag,
        };
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
  });
}
