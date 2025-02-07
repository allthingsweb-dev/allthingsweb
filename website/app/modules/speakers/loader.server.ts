import cachified from '@epic-web/cachified';
import { Speaker, Talk } from '../pocketbase/pocketbase';
import { lru } from '../cache';
import { json, LoaderFunctionArgs } from 'react-router';
import { ServerTimingsProfiler } from '../server-timing.server';
import { createPocketbaseClient } from '../pocketbase/api.server';

export type TalkWithEventSlug = Talk & {
  eventName: string;
  eventSlug: string;
  eventStart: Date;
};

export type SpeakerWithTalks = Speaker & {
  talks: TalkWithEventSlug[];
};

type Deps = {
  serverTimingsProfiler: ServerTimingsProfiler;
  pocketBaseClient: ReturnType<typeof createPocketbaseClient>;
};
export async function fetchSpeakersWithTalks({ serverTimingsProfiler, pocketBaseClient }: Deps) {
  const { time } = serverTimingsProfiler;
  const speakersWithTalks = await cachified({
    key: 'speakersWithTalks',
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue: async () => {
      const [events, talks, speakers] = await Promise.all([
        time('getEvents', pocketBaseClient.getEvents),
        time('getTalks', pocketBaseClient.getTalks),
        time('getSpeakers', pocketBaseClient.getSpeakers),
      ]);
      const speakersWithTalks: SpeakerWithTalks[] = [];
      for (const speaker of speakers) {
        const speakerTalks = talks.filter((talk) => talk.speakerId === speaker.id);
        if (!speakerTalks.length) {
          continue;
        }
        const talksWithEventInfo: TalkWithEventSlug[] = [];
        for (const talk of speakerTalks) {
          const event = events.find((event) => event.talkIds.includes(talk.id));
          if (!event) {
            continue;
          }
          talksWithEventInfo.push({
            ...talk,
            eventSlug: event.slug,
            eventStart: event.start,
            eventName: event.name,
          });
        }
        if (!talksWithEventInfo.length) {
          continue;
        }
        speakersWithTalks.push({ ...speaker, talks: talksWithEventInfo });
      }
      return speakersWithTalks;
    },
  });

  // Randomize the order of speakers
  speakersWithTalks.sort(() => Math.random() - 0.5);

  return speakersWithTalks;
}

export async function speakersLoader({ context }: LoaderFunctionArgs) {
  const { getServerTimingHeader } = context.serverTimingsProfiler;
  const speakersWithTalks = await fetchSpeakersWithTalks({
    serverTimingsProfiler: context.serverTimingsProfiler,
    pocketBaseClient: context.pocketBaseClient,
  });
  return Response.json({ speakersWithTalks }, { headers: getServerTimingHeader() });
}
