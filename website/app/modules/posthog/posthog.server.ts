import { PostHog } from "posthog-node";
import { env } from "../env";

const client = env.posthogPublicAPIKey
  ? new PostHog(env.posthogPublicAPIKey, {
      host: "https://us.i.posthog.com",
    })
  : null;

export function trackEvent(
  eventName: string,
  distinctId: string,
  properties: Record<string, unknown>
) {
  if (!client) {
    return;
  }
  client.capture({
    distinctId,
    event: eventName,
    properties,
  });
}
