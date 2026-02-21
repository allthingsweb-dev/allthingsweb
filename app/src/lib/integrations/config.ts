import { configSchema, server } from "better-env/config-schema";

const integrationsEnvConfig = configSchema("Integrations", {
  resendApiKey: server({
    env: "RESEND_API_KEY",
    optional: true,
  }),
  lumaApiKey: server({
    env: "LUMA_API_KEY",
    optional: true,
  }),
});

export const integrationsConfig = {
  resendApiKey: integrationsEnvConfig.server.resendApiKey,
  lumaApiKey: integrationsEnvConfig.server.lumaApiKey,
};
