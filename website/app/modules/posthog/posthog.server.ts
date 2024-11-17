import { PostHog } from 'posthog-node';
import { env } from '../env.server';

const client = env.posthogPublicAPIKey
  ? new PostHog(env.posthogPublicAPIKey, {
      host: 'https://us.i.posthog.com',
    })
  : null;

/**
 * Define properties of custom analytics events here.
 * @example
 *  // First time registration for an event. Use event slug as distinct ID.
 * 'attendee registered': {
 *   attendee_id: string;
 *   event_name: string;
 *   event_id: string;
 *   type: 'website' | 'Luma';
 * };
 */
type AnalyticsEventProperties = {};

export type AnalyticsEventName = keyof AnalyticsEventProperties;

export function trackEvent<T extends AnalyticsEventName>(
  eventName: T,
  distinctId: string,
  properties: AnalyticsEventProperties[T],
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
