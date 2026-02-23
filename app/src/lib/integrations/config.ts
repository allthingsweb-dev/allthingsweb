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
  lumaCalendarApiId: server({
    env: "LUMA_CALENDAR_API_ID",
    optional: true,
  }),
  lumaCalendarHandle: server({
    env: "LUMA_CALENDAR_HANDLE",
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
  lumaApiKey: integrationsEnvConfig.server.lumaApiKey,
  lumaCalendarApiId: integrationsEnvConfig.server.lumaCalendarApiId,
  lumaCalendarHandle: integrationsEnvConfig.server.lumaCalendarHandle,
  discordBotToken: integrationsEnvConfig.server.discordBotToken,
  discordReviewChannelId: integrationsEnvConfig.server.discordReviewChannelId,
};
