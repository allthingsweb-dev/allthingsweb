import { json, LoaderFunctionArgs } from '@remix-run/server-runtime';
import { cachified } from '@epic-web/cachified';
import { getAttendeeCount, getExpandedEventBySlug } from '~/modules/pocketbase/api.server.ts';
import { isEventInPast } from '~/modules/pocketbase/pocketbase.ts';
import { getAttendeeCount as getLumaAttendeeCount } from '~/modules/luma/api.server.ts';
import { notFound } from '~/modules/responses.server.ts';
import { captureException } from '~/modules/sentry/capture.server.ts';
import { lru } from '../cache.ts';
import { getServerTiming } from '~/modules/server-timing.server.ts';

export async function eventDetailsLoader(slug: string) {
  const { time, getServerTimingHeader } = getServerTiming();
  const event = await cachified({
    key: `getExpandedEventBySlug-${slug}`,
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue() {
      return time('getExpandedEventBySlug', () => getExpandedEventBySlug(slug));
    },
  });
  if (!event) {
    throw notFound();
  }

  const attendeeCount = await cachified({
    key: `getAttendeeCount-${slug}`,
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue() {
      try {
        const lumaEventId = event.lumaEventId;
        if (event.enableRegistrations) {
          return time('getAttendeeCount', () => getAttendeeCount(event.id));
        } else if (lumaEventId) {
          return time(
            'getLumaAttendeeCount',
            () => getLumaAttendeeCount(lumaEventId),
          );
        }
        return 0;
      } catch (error) {
        console.error(error);
        captureException(error);
        return 0;
      }
    },
  });

  const isAtCapacity = attendeeCount >= event.attendeeLimit;
  const isInPast = isEventInPast(event);
  return json(
    {
      event,
      attendeeCount,
      attendeeLimit: event.attendeeLimit,
      isAtCapacity,
      isInPast,
    },
    { headers: getServerTimingHeader() },
  );
}

export function loader({ params }: LoaderFunctionArgs) {
  if (!params.slug) {
    throw new Error('No slug provided');
  }
  return eventDetailsLoader(params.slug);
}
