import { configSchema, server } from "better-env/config-schema";

const electricEnvConfig = configSchema("Electric", {
  sourceId: server({
    env: "ELECTRIC_SQL_CLOUD_SOURCE_ID",
  }),
  sourceSecret: server({
    env: "ELECTRIC_SQL_CLOUD_SOURCE_SECRET",
  }),
});

export const electricConfig = {
  sourceId: electricEnvConfig.server.sourceId,
  sourceSecret: electricEnvConfig.server.sourceSecret,
};
