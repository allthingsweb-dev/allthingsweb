import invariant from 'tiny-invariant';

function enforceInProd(variable: string | undefined, variableName: string) {
  const isProduction = environment === 'production';
  if (isProduction) {
    invariant(variable, `${variableName} env variable is required.`);
  } else if (!variable) {
    console.warn(`${variableName} env variable is not set.`);
  }
}

const environment = Deno.env.get('NODE_ENV');
invariant(environment, 'NODE_ENV env variable is required');

const sessionSecret = Deno.env.get('SESSION_SECRET');
invariant(sessionSecret, 'SESSION_SECRET env variable is required');

const pocketbaseOrigin = Deno.env.get('POCKETBASE_ORIGIN');
const publicPocketbaseOrigin = Deno.env.get('PUBLIC_POCKETBASE_ORIGIN');
invariant(pocketbaseOrigin, 'POCKETBASE_ORIGIN env variable is required');
invariant(
  publicPocketbaseOrigin,
  'PUBLIC_POCKETBASE_ORIGIN env variable is required',
);

const pocketbaseAdminEmail = Deno.env.get('POCKETBASE_EMAIL');
const pocketbaseAdminPassword = Deno.env.get('POCKETBASE_PASSWORD');
invariant(pocketbaseAdminEmail, 'POCKETBASE_EMAIL env variable is required');
invariant(
  pocketbaseAdminPassword,
  'POCKETBASE_PASSWORD env variable is required',
);

const resendAPIKey = Deno.env.get('RESEND_API_KEY');
enforceInProd(resendAPIKey, 'RESEND_API_KEY');

const origin = Deno.env.get('ORIGIN');
invariant(origin, 'ORIGIN env variable is required');

const lumaAPIKey = Deno.env.get('LUMA_API_KEY');
enforceInProd(lumaAPIKey, 'LUMA_API_KEY');

const zapierWebhookSecret = Deno.env.get('ZAPIER_WEBHOOK_SECRET');
enforceInProd(zapierWebhookSecret, 'ZAPIER_WEBHOOK_SECRET');

const posthogPublicAPIKey = Deno.env.get('POSTHOG_PUBLIC_API_KEY');
if (!posthogPublicAPIKey) {
  console.warn('POSTHOG_PUBLIC_API_KEY env variable is not set');
}

const sentryDsn = Deno.env.get('SENTRY_DSN');
if (!sentryDsn) {
  console.warn('SENTRY_DSN env variable is not set');
}
enforceInProd(Deno.env.get('SENTRY_ORG'), 'SENTRY_ORG');
enforceInProd(Deno.env.get('SENTRY_PROJECT'), 'SENTRY_PROJECT');
enforceInProd(Deno.env.get('SENTRY_AUTH_TOKEN'), 'SENTRY_AUTH_TOKEN');

const inngestSigningKey = Deno.env.get('INNGEST_SIGNING_KEY');
const inngestEventKey = Deno.env.get('INNGEST_EVENT_KEY');
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
