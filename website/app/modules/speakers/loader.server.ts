import { getEvents, getSpeakers, getTalks } from "../pocketbase/api.server";
import { Speaker, Talk } from "../pocketbase/pocketbase";

export type TalkWithEventSlug = Talk & {
  eventName: string;
  eventSlug: string;
  eventStart: Date;
};

export type SpeakerWithTalks = Speaker & {
  talks: TalkWithEventSlug[];
};

export async function speakersLoader() {
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
    speakersWithTalks.push({ ...speaker, talks: talksWithEventInfo });
  }

  // Randomize the order of speakers
  speakersWithTalks.sort(() => Math.random() - 0.5);

  return { speakersWithTalks };
}
