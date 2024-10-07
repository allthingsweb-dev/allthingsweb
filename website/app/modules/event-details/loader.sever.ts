import { LoaderFunctionArgs } from '@remix-run/node';
import { getAttendeeCount, getExpandedEventBySlug } from '../pocketbase/api.server';
import { isEventInPast } from '../pocketbase/pocketbase';
import { getAttendeeCount as getLumaAttendeeCount } from '../luma/api.server';
import { notFound } from '../responses.server';
import { captureException } from '../sentry/capture.server';
import cachified from '@epic-web/cachified';
import { lru } from '../cache';

export async function eventDetailsLoader(slug: string) {
  const event = await cachified({
    key: `getExpandedEventBySlug-${slug}`,
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    async getFreshValue() {
      return getExpandedEventBySlug(slug);
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
    async getFreshValue() {
      try {
        if (event.enableRegistrations) {
          return getAttendeeCount(event.id);
        } else if (event.lumaEventId) {
          return getLumaAttendeeCount(event.lumaEventId);
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
  return {
    event,
    attendeeCount,
    attendeeLimit: event.attendeeLimit,
    isAtCapacity,
    isInPast,
  };
}

export function loader({ params }: LoaderFunctionArgs) {
  if (!params.slug) {
    throw new Error('No slug provided');
  }
  return eventDetailsLoader(params.slug);
}
