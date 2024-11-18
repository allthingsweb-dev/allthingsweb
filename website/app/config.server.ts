/* eslint no-console: 0 */
import { z } from 'zod';
import type { Schema, ZodTypeDef } from 'zod';
import crypto from 'node:crypto';

// Validation
const validateConfigOrExit = <T, I>(schema: Schema<T, ZodTypeDef, I>, intent: I): T => {
  try {
    const config = schema.parse(intent);
    return config;
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

const LogLevelSchemaAware = z.object({
  logLevel: z
    .array(z.enum(['debug', 'info']))
    .min(0)
    .max(2),
});

const PocketBaseSchema = z.object({
  origin: z.string().url(),
  publicOrigin: z.string().url(),
  adminEmail: z.string().min(1),
  adminPassword: z.string().min(1),
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
    pocketbase: PocketBaseSchema,
    posthog: PosthogSchema,
    resend: ResendSchema,
    luma: LumaSchema,
    zapier: ZapierSchema,
    sentry: SentrySchema,
  })
  .merge(InstanceSchema)
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
const MainConfig: MainConfig = validateConfigOrExit(MainConfigSchema, {
  instanceId: process.env.INSTANCE_ID || crypto.randomUUID(),
  logLevel: ['info', 'debug'],
  port,
  environment: process.env.NODE_ENV || 'development',
  origin: process.env.ORIGIN || `http://localhost:${port}`,
  pocketbase: {
    origin: process.env.POCKETBASE_ORIGIN || '',
    publicOrigin: process.env.PUBLIC_POCKETBASE_ORIGIN || '',
    adminEmail: process.env.POCKETBASE_EMAIL || '',
    adminPassword: process.env.POCKETBASE_PASSWORD || '',
  },
  sessionSecret: process.env.SESSION_SECRET || 'local-session-secret-' + crypto.randomUUID(),
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

export default MainConfig;
