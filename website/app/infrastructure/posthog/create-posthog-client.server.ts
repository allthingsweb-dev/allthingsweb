import { MainConfig } from '~/domain/contracts/config';
import { PostHog } from 'posthog-node';

type Deps = {
  mainConfig: MainConfig;
};

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

export const createPosthogClient = ({ mainConfig }: Deps) => {
  if (!mainConfig.posthog.publicApiKey) {
    return {
      trackEvent: () => {
        return;
      },
    };
  }

  const client = new PostHog(mainConfig.posthog.publicApiKey, {
    host: 'https://us.i.posthog.com',
  });

  const trackEvent = <T extends AnalyticsEventName>(
    eventName: T,
    distinctId: string,
    properties: AnalyticsEventProperties[T],
  ) => {
    client.capture({
      distinctId,
      event: eventName,
      properties,
    });
  };

  return {
    trackEvent,
  };
};
