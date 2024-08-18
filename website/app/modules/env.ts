import invariant from "tiny-invariant";

const pocketbaseOrigin = process.env.POCKETBASE_ORIGIN;
invariant(pocketbaseOrigin, "POCKETBASE_ORIGIN env variable is required");

const resendAPIKey = process.env.RESEND_API_KEY;
invariant(resendAPIKey, "RESEND_API_KEY env variable is required");

const origin = process.env.ORIGIN;
invariant(origin, "ORIGIN env variable is required");

const posthogPublicAPIKey = process.env.POSTHOG_PUBLIC_API_KEY;
if (!posthogPublicAPIKey) {
  console.warn("POSTHOG_PUBLIC_API_KEY env variable is not set");
}

export const env = {
  pocketbaseOrigin,
  posthogPublicAPIKey,
  resendAPIKey,
  server: {
    origin,
  },
};
