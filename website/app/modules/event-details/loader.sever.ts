import { LoaderFunctionArgs, json } from '@remix-run/node';
import { isEventInPast } from '../pocketbase/pocketbase';
import { notFound } from '../responses.server';
import { captureException } from '../sentry/capture.server';
import cachified from '@epic-web/cachified';
import { lru } from '../cache';
import { ServerTimingsProfiler } from '../server-timing.server';
import { createPocketbaseClient } from '../pocketbase/api.server';
import { createLumaClient } from '../luma/api.server';

type Deps = {
  serverTimingsProfiler: ServerTimingsProfiler;
  pocketBaseClient: ReturnType<typeof createPocketbaseClient>;
  lumaClient: ReturnType<typeof createLumaClient>;
};
export async function eventDetailsLoader(slug: string, { serverTimingsProfiler, pocketBaseClient, lumaClient }: Deps) {
  const { time, getServerTimingHeader } = serverTimingsProfiler;
  const event = await cachified({
    key: `getExpandedEventBySlug-${slug}`,
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue() {
      return time('getExpandedEventBySlug', () => pocketBaseClient.getExpandedEventBySlug(slug));
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
        if (!lumaEventId) {
          return 0;
        }
        return time('getLumaAttendeeCount', () => lumaClient.getAttendeeCount(lumaEventId));
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

export function loader({ params, context }: LoaderFunctionArgs) {
  if (!params.slug) {
    throw new Error('No slug provided');
  }
  return eventDetailsLoader(params.slug, {
    serverTimingsProfiler: context.serverTimingsProfiler,
    pocketBaseClient: context.pocketBaseClient,
    lumaClient: context.services.lumaClient,
  });
}
