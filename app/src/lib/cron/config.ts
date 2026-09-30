import { configSchema, server } from "better-env/config-schema";

const cronEnvConfig = configSchema("Cron", {
  secret: server({
    env: "CRON_SECRET",
    optional: true,
  }),
});

export const cronConfig = {
  secret: cronEnvConfig.server.secret,
};
