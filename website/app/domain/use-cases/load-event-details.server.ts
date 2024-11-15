import { Envelope, QueryHandlerDefinition } from 'missive.js';
import { ServerTimingsProfiler } from '../contracts/server-timings-profiler';
import { PocketBaseClient } from '../contracts/pocketbase';
import { notFound } from '~/modules/responses.server';
import { captureException } from '@sentry/remix';
import { isEventInPast } from '~/modules/pocketbase/pocketbase';
import { LumaClient } from '../contracts/luma';

type Deps = {
  serverTimingsProfiler: ServerTimingsProfiler;
  pocketBaseClient: PocketBaseClient;
  lumaClient: LumaClient;
};

type Query = { slug: string };
type Result = Awaited<ReturnType<typeof handler>>;

export type LoadEventDetailsHandlerDefinition = QueryHandlerDefinition<'LoadEventDetails', Query, Result>;

const handler = async (envelope: Envelope<Query>, { serverTimingsProfiler, pocketBaseClient, lumaClient }: Deps) => {
  const event = await serverTimingsProfiler.time('getEvent', () =>
    pocketBaseClient.getExpandedEventBySlug(envelope.message.slug),
  );
  if (!event) {
    throw notFound();
  }
  const attendeeCount = await (async () => {
    try {
      const lumaEventId = event.lumaEventId;
      if (event.enableRegistrations) {
        return await serverTimingsProfiler.time('getAttendeeCount', () => lumaClient.getAttendeeCount(event.id));
      } else if (lumaEventId) {
        return await serverTimingsProfiler.time('getLumaAttendeeCount', () => lumaClient.getAttendeeCount(lumaEventId));
      }
      return 0;
    } catch (error) {
      console.error(error);
      captureException(error);
      return 0;
    }
  })();
  const isAtCapacity = attendeeCount >= event.attendeeLimit;
  const isInPast = isEventInPast(event);
  return {
    event,
    attendeeCount,
    attendeeLimit: event.attendeeLimit,
    isAtCapacity,
    isInPast,
  };
};
export const createLoadEventDetailsHandler = (deps: Deps) => (query: Envelope<Query>) => handler(query, deps);
