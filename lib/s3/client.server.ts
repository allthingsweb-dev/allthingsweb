import { S3Client as AWSS3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type Deps = {
  mainConfig: {
    s3: {
      accessKeyId: string;
      secretAccessKey: string;
      region: string;
      url: string;
      bucket: string;
    }
  }
};

export type S3Client = ReturnType<typeof createS3Client>;

export function createS3Client({ mainConfig }: Deps) {
  const s3Client = new AWSS3Client({
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
    region: mainConfig.s3.region,
  });

  async function presign(url: string) {
    // Remove the endpoint from the URL to extract the key
    const key = url.replace(mainConfig.s3.url + "/", "");
    const command = new GetObjectCommand({
      Bucket: mainConfig.s3.bucket, // Ensure your config includes the bucket name
      Key: key,
    });
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 60 * 60 * 24, // 1 day in seconds
    });
    return signedUrl;
  }

  return { presign };
}
