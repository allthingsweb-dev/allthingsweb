import cachified from '@epic-web/cachified';
import { getEvents, getSpeakers, getTalks } from '../pocketbase/api.server';
import { Speaker, Talk } from '../pocketbase/pocketbase';
import { lru } from '../cache';

export type TalkWithEventSlug = Talk & {
  eventName: string;
  eventSlug: string;
  eventStart: Date;
};

export type SpeakerWithTalks = Speaker & {
  talks: TalkWithEventSlug[];
};

export async function speakersLoader() {
  const speakersWithTalks = await cachified({
    key: 'speakersWithTalks',
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue: async () => {
      const [events, talks, speakers] = await Promise.all([getEvents(), getTalks(), getSpeakers()]);
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

  return { speakersWithTalks };
}
