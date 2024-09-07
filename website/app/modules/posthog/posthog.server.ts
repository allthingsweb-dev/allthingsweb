import { PostHog } from 'posthog-node';
import { env } from '../env.server';

const client = env.posthogPublicAPIKey
  ? new PostHog(env.posthogPublicAPIKey, {
      host: 'https://us.i.posthog.com',
    })
  : null;

type AnalyticsEventProperties = {
  // First time registration for an event. Use event slug as distinct ID.
  'attendee registered': {
    attendee_id: string;
    event_name: string;
    event_id: string;
    type: 'website' | 'Luma';
  };
  // Registered for an event already registered for. Use event slug as distinct ID.
  'attendee re-registered': {
    attendee_id: string;
    event_name: string;
    event_id: string;
    type: 'website' | 'Luma';
  };
  // Canceled registration for an event. Use event slug as distinct ID.
  'attendee canceled': {
    attendee_id: string;
    event_name: string;
    event_id: string;
    type: 'website' | 'Luma';
  };
  // Uncanceled registration for an event (re-registered after canceling). Use event slug as distinct ID.
  'attendee uncanceled': {
    attendee_id: string;
    event_name: string;
    event_id: string;
    type: 'website' | 'Luma';
  };
  // Declined registration for an event because event is already full. Use event slug as distinct ID.
  'registration declined': {
    attendee_id?: string;
    event_name: string;
    event_id: string;
  };
};

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
