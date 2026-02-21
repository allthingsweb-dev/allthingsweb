import { configSchema, server } from "better-env/config-schema";
import { z } from "zod";

const storageEnvConfig = configSchema("Storage", {
  accessKeyId: server({
    env: "AWS_S3_ACCESS_KEY",
  }),
  secretAccessKey: server({
    env: "AWS_S3_SECRET_ACCESS_KEY",
  }),
  url: server({
    env: "AWS_S3_URL",
    schema: z.url(),
  }),
  bucket: server({
    env: "AWS_S3_BUCKET",
  }),
  region: server({
    env: "AWS_S3_REGION",
  }),
});

export const storageConfig = {
  accessKeyId: storageEnvConfig.server.accessKeyId,
  secretAccessKey: storageEnvConfig.server.secretAccessKey,
  url: storageEnvConfig.server.url,
  bucket: storageEnvConfig.server.bucket,
  region: storageEnvConfig.server.region,
};
