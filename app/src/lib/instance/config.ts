import { configSchema, server } from "better-env/config-schema";
import { z } from "zod";

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
  vercelUrl: server({
    env: "VERCEL_URL",
    optional: true,
  }),
});

function resolveOrigin() {
  if (instanceEnvConfig.server.vercelUrl) {
    return `https://${instanceEnvConfig.server.vercelUrl}`;
  }

  if (instanceEnvConfig.server.origin) {
    return instanceEnvConfig.server.origin;
  }

  return `http://localhost:${instanceEnvConfig.server.port}`;
}

export const instanceConfig = {
  environment: instanceEnvConfig.server.nodeEnv,
  origin: resolveOrigin(),
};
