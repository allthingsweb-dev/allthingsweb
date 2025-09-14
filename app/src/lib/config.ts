import { z } from "zod";

const instanceSchema = z.object({
  environment: z.enum(["development", "production", "test"]),
  origin: z.url(),
});

const neonAuthSchema = z.object({
  stackProjectId: z.string(),
  stackPublishableClientKey: z.string(),
  stackSecretServerKey: z.string(),
});

const databaseSchema = z.object({
  databaseUrl: z.string(),
  neonAuth: neonAuthSchema,
});

const s3Schema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  url: z.url(),
  bucket: z.string(),
  region: z.string(),
});

const resendSchema = z.object({
  apiKey: z.string().optional(),
});

const lumaSchema = z.object({
  apiKey: z.string().optional(),
});

const configSchema = z.object({
  instance: instanceSchema,
  database: databaseSchema,
  s3: s3Schema,
  resend: resendSchema,
  luma: lumaSchema,
});

type PreValidate<ConfigData> = {
  [K in keyof ConfigData]: ConfigData[K] extends object
    ? PreValidate<ConfigData[K]> | undefined
    : ConfigData[K] extends string
      ? string | undefined // use string instead of enum values
      : ConfigData[K] | undefined;
};

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
const configData: PreValidate<MainConfig> = {
  instance: {
    environment: process.env.NODE_ENV || "development",
    origin: process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.ORIGIN || `http://localhost:${port}`,
  },
  database: {
    databaseUrl: process.env.DATABASE_URL,
    neonAuth: {
      stackProjectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
      stackPublishableClientKey:
        process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
      stackSecretServerKey: process.env.STACK_SECRET_SERVER_KEY,
    },
  },
  s3: {
    accessKeyId: process.env.AWS_S3_ACCESS_KEY,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
    url: process.env.AWS_S3_URL,
    bucket: process.env.AWS_S3_BUCKET,
    region: process.env.AWS_S3_REGION,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
  },
  luma: {
    apiKey: process.env.LUMA_API_KEY,
  },
};

export type MainConfig = z.infer<typeof configSchema>;
export const mainConfig: MainConfig = configSchema.parse(configData);
