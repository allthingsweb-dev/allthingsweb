import { z } from 'zod';

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
  apiKey: z.string().min(1),
});

const ZapierSchema = z.object({
  webhookSecret: z.string().min(1),
});

const PosthogSchema = z.object({
  publicApiKey: z.string().min(1),
});

const SentrySchema = z.object({
  dsn: z.string().optional(),
  org: z.string().optional(),
  project: z.string().optional(),
  authToken: z.string().optional(),
});

const InngestSchema = z.object({
  signingKey: z.string().optional(),
  eventKey: z.string().optional(),
});

export const MainConfigSchema = z
  .object({
    pocketbase: PocketBaseSchema,
    inngest: InngestSchema,
    posthog: PosthogSchema,
    resend: ResendSchema,
    luma: LumaSchema,
    zapier: ZapierSchema,
    sentry: SentrySchema,
  })
  .merge(InstanceSchema)
  .merge(LogLevelSchemaAware);
export type MainConfig = z.infer<typeof MainConfigSchema>;
