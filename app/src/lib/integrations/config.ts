import { configSchema, server } from "better-env/config-schema";

const integrationsEnvConfig = configSchema("Integrations", {
  resendApiKey: server({
    env: "RESEND_API_KEY",
    optional: true,
  }),
  discordBotToken: server({
    env: "DISCORD_BOT_TOKEN",
    optional: true,
  }),
  discordReviewChannelId: server({
    env: "DISCORD_REVIEW_CHANNEL_ID",
    optional: true,
  }),
});

export const integrationsConfig = {
  resendApiKey: integrationsEnvConfig.server.resendApiKey,
  discordBotToken: integrationsEnvConfig.server.discordBotToken,
  discordReviewChannelId: integrationsEnvConfig.server.discordReviewChannelId,
};
