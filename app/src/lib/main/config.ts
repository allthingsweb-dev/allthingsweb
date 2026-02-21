import { configSchema, server } from "better-env/config-schema";
import { z } from "zod";

const envConfig = configSchema("Main", {
  nodeEnv: server({
    env: "NODE_ENV",
    schema: z
      .enum(["development", "preview", "production", "test", "local"])
      .default("development"),
  }),
  port: server({
    env: "PORT",
    schema: z.coerce.number().default(3000),
  }),
  origin: server({
    env: "ORIGIN",
    schema: z.url(),
    optional: true,
  }),
  vercelUrl: server({
    env: "VERCEL_URL",
    optional: true,
  }),
  databaseUrl: server({
    env: "DATABASE_URL",
  }),
  stackProjectId: server({
    env: "NEXT_PUBLIC_STACK_PROJECT_ID",
  }),
  stackPublishableClientKey: server({
    env: "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
  }),
  stackSecretServerKey: server({
    env: "STACK_SECRET_SERVER_KEY",
  }),
  electricSQLCloudSourceId: server({
    env: "ELECTRIC_SQL_CLOUD_SOURCE_ID",
  }),
  electricSQLCloudSourceSecret: server({
    env: "ELECTRIC_SQL_CLOUD_SOURCE_SECRET",
  }),
  awsS3AccessKey: server({
    env: "AWS_S3_ACCESS_KEY",
  }),
  awsS3SecretAccessKey: server({
    env: "AWS_S3_SECRET_ACCESS_KEY",
  }),
  awsS3Url: server({
    env: "AWS_S3_URL",
    schema: z.url(),
  }),
  awsS3Bucket: server({
    env: "AWS_S3_BUCKET",
  }),
  awsS3Region: server({
    env: "AWS_S3_REGION",
  }),
  resendApiKey: server({
    env: "RESEND_API_KEY",
    optional: true,
  }),
  lumaApiKey: server({
    env: "LUMA_API_KEY",
    optional: true,
  }),
});

function resolveOrigin() {
  if (envConfig.server.vercelUrl) {
    return `https://${envConfig.server.vercelUrl}`;
  }

  if (envConfig.server.origin) {
    return envConfig.server.origin;
  }

  return `http://localhost:${envConfig.server.port}`;
}

export const mainConfig = {
  instance: {
    environment: envConfig.server.nodeEnv,
    origin: resolveOrigin(),
  },
  database: {
    databaseUrl: envConfig.server.databaseUrl,
    neonAuth: {
      stackProjectId: envConfig.server.stackProjectId,
      stackPublishableClientKey: envConfig.server.stackPublishableClientKey,
      stackSecretServerKey: envConfig.server.stackSecretServerKey,
    },
  },
  electricSQL: {
    sourceId: envConfig.server.electricSQLCloudSourceId,
    sourceSecret: envConfig.server.electricSQLCloudSourceSecret,
  },
  s3: {
    accessKeyId: envConfig.server.awsS3AccessKey,
    secretAccessKey: envConfig.server.awsS3SecretAccessKey,
    url: envConfig.server.awsS3Url,
    bucket: envConfig.server.awsS3Bucket,
    region: envConfig.server.awsS3Region,
  },
  resend: {
    apiKey: envConfig.server.resendApiKey,
  },
  luma: {
    apiKey: envConfig.server.lumaApiKey,
  },
};

export type MainConfig = typeof mainConfig;
