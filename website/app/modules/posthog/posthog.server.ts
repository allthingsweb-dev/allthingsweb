import { PostHog } from 'posthog-node';
import { mainConfig } from '~/config.server';

type Deps = {
  mainConfig,
};
type AnalyticsEventProperties = {};
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
