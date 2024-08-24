import invariant from "tiny-invariant";

const sessionSecret = process.env.SESSION_SECRET;
invariant(sessionSecret, "SESSION_SECRET env variable is required");

const pocketbaseOrigin = process.env.POCKETBASE_ORIGIN;
invariant(pocketbaseOrigin, "POCKETBASE_ORIGIN env variable is required");

const pocketbaseAdminEmail = process.env.POCKETBASE_EMAIL;
invariant(pocketbaseAdminEmail, "POCKETBASE_EMAIL env variable is required");

const pocketbaseAdminPassword = process.env.POCKETBASE_PASSWORD;
invariant(pocketbaseAdminPassword, "POCKETBASE_PASSWORD env variable is required");

const resendAPIKey = process.env.RESEND_API_KEY;
invariant(resendAPIKey, "RESEND_API_KEY env variable is required");

const origin = process.env.ORIGIN;
invariant(origin, "ORIGIN env variable is required");

const lumaAPIKey = process.env.LUMA_API_KEY;
invariant(lumaAPIKey, "LUMA_API_KEY env variable is required");

const zapierWebhookSecret = process.env.ZAPIER_WEBHOOK_SECRET;
invariant(zapierWebhookSecret, "ZAPIER_WEBHOOK_SECRET env variable is required");

const posthogPublicAPIKey = process.env.POSTHOG_PUBLIC_API_KEY;
if (!posthogPublicAPIKey) {
  console.warn("POSTHOG_PUBLIC_API_KEY env variable is not set");
}

const sentryDsn = process.env.SENTRY_DSN;
if (!sentryDsn) {
  console.warn("SENTRY_DSN env variable is not set");
}

const isInngestEnabled = process.env.INNGEST_ENABLED === "true";
invariant(process.env.INNGEST_SIGNING_KEY, "INNGEST signing key is required by the inngest library");
invariant(process.env.INNGEST_EVENT_KEY, "INNGEST event key is required by the inngest library");

export const env = {
  sessionSecret,
  pocketbase: {
    origin: pocketbaseOrigin,
    adminEmail: pocketbaseAdminEmail,
    adminPassword: pocketbaseAdminPassword,
  },
  isInngestEnabled,
  posthogPublicAPIKey,
  resendAPIKey,
  lumaAPIKey,
  zapierWebhookSecret,
  sentryDsn,
  server: {
    origin,
  },
};
