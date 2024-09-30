import { LoaderFunctionArgs } from '@remix-run/node';
import { getAttendeeCount, getExpandedEventBySlug } from '../pocketbase/api.server';
import { isEventInPast } from '../pocketbase/pocketbase';
import { getAttendeeCount as getLumaAttendeeCount } from '../luma/api.server';
import { notFound } from '../responses.server';
import { captureException } from '../sentry/capture.server';

export async function eventDetailsLoader(slug: string) {
  const event = await getExpandedEventBySlug(slug);
  if (!event) {
    throw notFound();
  }

  let attendeeCount = 0;
  try {
    if (event.enableRegistrations) {
      attendeeCount = await getAttendeeCount(event.id);
    } else if (event.lumaEventId) {
      attendeeCount = await getLumaAttendeeCount(event.lumaEventId);
    }
  } catch (error) {
    console.error(error);
    captureException(error);
  }

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
