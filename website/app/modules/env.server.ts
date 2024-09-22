import invariant from 'tiny-invariant';

function enforceInProd(variable: string | undefined, variableName: string) {
  const isProduction = environment === 'production';
  if (isProduction) {
    invariant(variable, `${variableName} env variable is required.`);
  } else if (!variable) {
    console.warn(`${variableName} env variable is not set.`);
  }
}

const environment = process.env.NODE_ENV;
invariant(environment, 'NODE_ENV env variable is required');

const sessionSecret = process.env.SESSION_SECRET;
invariant(sessionSecret, 'SESSION_SECRET env variable is required');

const pocketbaseOrigin = process.env.POCKETBASE_ORIGIN;
const publicPocketbaseOrigin = process.env.PUBLIC_POCKETBASE_ORIGIN;
invariant(pocketbaseOrigin, 'POCKETBASE_ORIGIN env variable is required');
invariant(publicPocketbaseOrigin, 'PUBLIC_POCKETBASE_ORIGIN env variable is required');

const pocketbaseAdminEmail = process.env.POCKETBASE_EMAIL;
const pocketbaseAdminPassword = process.env.POCKETBASE_PASSWORD;
invariant(pocketbaseAdminEmail, 'POCKETBASE_EMAIL env variable is required');
invariant(pocketbaseAdminPassword, 'POCKETBASE_PASSWORD env variable is required');

const resendAPIKey = process.env.RESEND_API_KEY;
enforceInProd(resendAPIKey, 'RESEND_API_KEY');

const origin = process.env.ORIGIN;
invariant(origin, 'ORIGIN env variable is required');

const lumaAPIKey = process.env.LUMA_API_KEY;
enforceInProd(lumaAPIKey, 'LUMA_API_KEY');

const zapierWebhookSecret = process.env.ZAPIER_WEBHOOK_SECRET;
enforceInProd(zapierWebhookSecret, 'ZAPIER_WEBHOOK_SECRET');

const posthogPublicAPIKey = process.env.POSTHOG_PUBLIC_API_KEY;
if (!posthogPublicAPIKey) {
  console.warn('POSTHOG_PUBLIC_API_KEY env variable is not set');
}

const sentryDsn = process.env.SENTRY_DSN;
if (!sentryDsn) {
  console.warn('SENTRY_DSN env variable is not set');
}
enforceInProd(process.env.SENTRY_ORG, 'SENTRY_ORG');
enforceInProd(process.env.SENTRY_PROJECT, 'SENTRY_PROJECT');
enforceInProd(process.env.SENTRY_AUTH_TOKEN, 'SENTRY_AUTH_TOKEN');

const inngestSigningKey = process.env.INNGEST_SIGNING_KEY;
const inngestEventKey = process.env.INNGEST_EVENT_KEY;
enforceInProd(inngestSigningKey, 'INNGEST_SIGNING_KEY');
enforceInProd(inngestEventKey, 'INNGEST_EVENT_KEY');

export const env = {
  environment,
  sessionSecret,
  pocketbase: {
    origin: pocketbaseOrigin,
    publicOrigin: publicPocketbaseOrigin,
    adminEmail: pocketbaseAdminEmail,
    adminPassword: pocketbaseAdminPassword,
  },
  inngest: {
    signingKey: inngestSigningKey,
    eventKey: inngestEventKey,
  },
  posthogPublicAPIKey,
  resendAPIKey,
  lumaAPIKey,
  zapierWebhookSecret,
  sentry: {
    dsn: sentryDsn,
  },
  server: {
    origin,
  },
};
