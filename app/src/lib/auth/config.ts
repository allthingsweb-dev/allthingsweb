import { configSchema, server } from "better-env/config-schema";

const authEnvConfig = configSchema("Auth", {
  stackProjectId: server({
    env: "NEXT_PUBLIC_STACK_PROJECT_ID",
  }),
  stackPublishableClientKey: server({
    env: "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
  }),
  stackSecretServerKey: server({
    env: "STACK_SECRET_SERVER_KEY",
  }),
});

export const authConfig = {
  stackProjectId: authEnvConfig.server.stackProjectId,
  stackPublishableClientKey: authEnvConfig.server.stackPublishableClientKey,
  stackSecretServerKey: authEnvConfig.server.stackSecretServerKey,
};
