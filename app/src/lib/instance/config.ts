import { configSchema, server } from "better-env/config-schema";
import { z } from "zod";
import { resolveOrigin } from "./origin";

const instanceEnvConfig = configSchema("Instance", {
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
  vercelEnv: server({
    env: "VERCEL_ENV",
    optional: true,
  }),
  vercelUrl: server({
    env: "VERCEL_URL",
    optional: true,
  }),
  vercelProjectProductionUrl: server({
    env: "VERCEL_PROJECT_PRODUCTION_URL",
    optional: true,
  }),
});

export const instanceConfig = {
  environment: instanceEnvConfig.server.nodeEnv,
  origin: resolveOrigin(instanceEnvConfig.server),
};
