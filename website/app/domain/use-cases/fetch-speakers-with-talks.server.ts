import { Envelope, QueryHandlerDefinition } from 'missive.js';
import { SpeakerWithTalks, TalkWithEventSlug } from '../contracts/content';
import { ServerTimingsProfiler } from '../contracts/server-timings-profiler';
import { PocketBaseClient } from '../contracts/pocketbase';

type Deps = {
  serverTimingsProfiler: ServerTimingsProfiler;
  pocketBaseClient: PocketBaseClient;
};

type Query = {};
type Result = Awaited<ReturnType<typeof handler>>;

export type FetchSpeakersWithTalksHandlerDefinition = QueryHandlerDefinition<'FetchSpeakersWithTalks', Query, Result>;

const handler = async (_: Envelope<Query>, { serverTimingsProfiler, pocketBaseClient }: Deps) => {
  const [events, talks, speakers] = await Promise.all([
    serverTimingsProfiler.time('getEvents', pocketBaseClient.getEvents),
    serverTimingsProfiler.time('getTalks', pocketBaseClient.getTalks),
    serverTimingsProfiler.time('getSpeakers', pocketBaseClient.getSpeakers),
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
};
export const createFetchSpeakersWithTalksHandler = (deps: Deps) => (query: Envelope<Query>) => handler(query, deps);
