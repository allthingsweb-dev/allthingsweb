import { z } from "zod";
import type { Schema, ZodTypeDef } from "zod";

type PreValidate<ConfigData> = {
  [K in keyof ConfigData]: ConfigData[K] extends object
    ? PreValidate<ConfigData[K]> | undefined
    : ConfigData[K] extends string
      ? string | undefined // use string instead of enum values
      : ConfigData[K] | undefined;
};

// Validation
const validateConfigOrExit = <T, I>(
  schema: Schema<T, ZodTypeDef, I>,
  data: PreValidate<I>,
): T => {
  try {
    return schema.parse(data);
  } catch (exception: any) {
    if (exception instanceof z.ZodError) {
      console.error("Configuration validation failed. Exit is forced.");
      exception.issues.forEach((issue) => {
        console.error(`\t- issue: ${issue.path.join(".")}: ${issue.message}`);
      });
    } else {
      console.error(exception);
    }
    process.exit(1);
  }
};

// Definitions
const InstanceSchema = z.object({
  environment: z.enum(["development", "production", "test"]),
  origin: z.string().url(),
});

const ClerkSchema = z.object({
  publishableKey: z.string(),
  secretKey: z.string(),
});

const ZeroSchema = z.object({
  syncServerUrl: z.string().url(),
  authSecret: z.string(),
});

const MainConfigSchema = z
  .object({
    clerk: ClerkSchema,
    zero: ZeroSchema,
  })
  .merge(InstanceSchema);

export type MainConfig = z.infer<typeof MainConfigSchema>;

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 5173;
export const mainConfig: MainConfig = validateConfigOrExit(MainConfigSchema, {
  environment: process.env.NODE_ENV || "development",
  origin: process.env.ORIGIN || `http://localhost:${port}`,
  clerk: {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  },
  zero: {
    syncServerUrl: process.env.ZERO_SERVER_URL,
    authSecret: process.env.ZERO_AUTH_SECRET,
  },
});
