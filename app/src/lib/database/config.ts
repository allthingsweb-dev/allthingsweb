import { configSchema, server } from "better-env/config-schema";

const databaseEnvConfig = configSchema("Database", {
  databaseUrl: server({
    env: "DATABASE_URL",
  }),
});

export const databaseConfig = {
  databaseUrl: databaseEnvConfig.server.databaseUrl,
};
