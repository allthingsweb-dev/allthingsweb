/* eslint no-console: 0 */
import { z } from 'zod';
import type { Schema, ZodTypeDef } from 'zod';
import crypto from 'node:crypto';

type PreValidate<ConfigData> = {
  [K in keyof ConfigData]: ConfigData[K] extends object
    ? PreValidate<ConfigData[K]> | undefined
    : ConfigData[K] extends string
      ? string | undefined // use string instead of enum values
      : ConfigData[K] | undefined;
};

// Validation
const validateConfigOrExit = <T, I>(schema: Schema<T, ZodTypeDef, I>, data: PreValidate<I>): T => {
  try {
    return schema.parse(data);
  } catch (exception: any) {
    if (exception instanceof z.ZodError) {
      console.error('Configuration validation failed. Exit is forced.');
      exception.issues.forEach((issue) => {
        console.error(`\t- issue: ${issue.path.join('.')}: ${issue.message}`);
      });
    } else {
      console.error(exception);
    }
    process.exit(1);
  }
};

// Definitions
const InstanceSchema = z.object({
  instanceId: z.string().min(1),
  environment: z.enum(['development', 'production', 'test']),
  sessionSecret: z.string().min(1),
  origin: z.string().url(),
  port: z.number().int().positive(),
});

const DbSchema = z.object({
  databaseUrl: z.string(),
});

const LogLevelSchemaAware = z.object({
  logLevel: z
    .array(z.enum(['debug', 'info']))
    .min(0)
    .max(2),
});

const S3Schema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  url: z.string().url(),
});

const ResendSchema = z.object({
  apiKey: z.string().optional(),
});

const LumaSchema = z.object({
  apiKey: z.string().optional(),
});

const ZapierSchema = z.object({
  webhookSecret: z.string().optional(),
});

const PosthogSchema = z.object({
  publicApiKey: z.string().optional(),
});

const SentrySchema = z.object({
  dsn: z.string().optional(),
  org: z.string().optional(),
  project: z.string().optional(),
  authToken: z.string().optional(),
});

const MainConfigSchema = z
  .object({
    posthog: PosthogSchema,
    resend: ResendSchema,
    luma: LumaSchema,
    zapier: ZapierSchema,
    sentry: SentrySchema,
    s3: S3Schema,
  })
  .merge(InstanceSchema)
  .merge(DbSchema)
  .merge(LogLevelSchemaAware)
  .superRefine((data, ctx) => {
    const addIssue = (name: string) => {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 1,
        type: 'string',
        inclusive: true,
        message: `In Production, ${name} is required.`,
      });
    };
    if (data.environment === 'production') {
      if (!data.resend.apiKey) {
        addIssue('RESEND_API_KEY');
      }
      if (!data.luma.apiKey) {
        addIssue('LUMA_API_KEY');
      }
      if (!data.zapier.webhookSecret) {
        addIssue('ZAPIER_WEBHOOK_SECRET');
      }
      if (!data.posthog.publicApiKey) {
        addIssue('POSTHOG_PUBLIC_API_KEY');
      }
      if (!data.sentry.dsn) {
        addIssue('SENTRY_DSN');
      }
      if (!data.sentry.org) {
        addIssue('SENTRY_ORG');
      }
      if (!data.sentry.project) {
        addIssue('SENTRY_PROJECT');
      }
      if (!data.sentry.authToken) {
        addIssue('SENTRY_AUTH_TOKEN');
      }
    }
  });

export type MainConfig = z.infer<typeof MainConfigSchema>;

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
export const mainConfig: MainConfig = validateConfigOrExit(MainConfigSchema, {
  instanceId: process.env.INSTANCE_ID || crypto.randomUUID(),
  logLevel: ['info', 'debug'],
  port,
  environment: process.env.NODE_ENV || 'development',
  origin: process.env.ORIGIN || `http://localhost:${port}`,
  sessionSecret: process.env.SESSION_SECRET || 'local-session-secret-' + crypto.randomUUID(),
  databaseUrl: process.env.DATABASE_URL,
  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    url: process.env.AWS_S3_URL,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
  },
  luma: {
    apiKey: process.env.LUMA_API_KEY,
  },
  zapier: {
    webhookSecret: process.env.ZAPIER_WEBHOOK_SECRET,
  },
  posthog: {
    publicApiKey: process.env.POSTHOG_PUBLIC_API_KEY,
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
  },
});
