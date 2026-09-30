import { configSchema, server } from "better-env/config-schema";

const integrationsEnvConfig = configSchema("Integrations", {
  resendApiKey: server({
    env: "RESEND_API_KEY",
    optional: true,
  }),
  aiGatewayApiKey: server({
    env: "AI_GATEWAY_API_KEY",
    optional: true,
  }),
  vercelOidcToken: server({
    env: "VERCEL_OIDC_TOKEN",
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
  discordPublicKey: server({
    env: "DISCORD_PUBLIC_KEY",
    optional: true,
  }),
  discordApplicationId: server({
    env: "DISCORD_APPLICATION_ID",
    optional: true,
  }),
  discordGuildId: server({
    env: "DISCORD_GUILD_ID",
    optional: true,
  }),
  redisUrl: server({
    env: "REDIS_URL",
    optional: true,
  }),
});

export const integrationsConfig = {
  resendApiKey: integrationsEnvConfig.server.resendApiKey,
  aiGatewayApiKey: integrationsEnvConfig.server.aiGatewayApiKey,
  vercelOidcToken: integrationsEnvConfig.server.vercelOidcToken,
  discordBotToken: integrationsEnvConfig.server.discordBotToken,
  discordReviewChannelId: integrationsEnvConfig.server.discordReviewChannelId,
  discordPublicKey: integrationsEnvConfig.server.discordPublicKey,
  discordApplicationId: integrationsEnvConfig.server.discordApplicationId,
  discordGuildId: integrationsEnvConfig.server.discordGuildId,
  redisUrl: integrationsEnvConfig.server.redisUrl,
};
