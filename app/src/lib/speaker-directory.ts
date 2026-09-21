import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  profilesTable,
  imagesTable,
  talksTable,
  talkSpeakersTable,
  eventTalksTable,
  eventsTable,
} from "./schema";

export async function getSpeakerDirectory(
  database: Pick<PgDatabase<PgQueryResultHKT>, "select">,
  now = new Date(),
) {
  // One relation supplies both the directory and its public talk links.
  const rows = await database
    .select({
      profile: profilesTable,
      image: imagesTable,
      talk: talksTable,
      event: {
        id: eventsTable.id,
        name: eventsTable.name,
        slug: eventsTable.slug,
        startDate: eventsTable.startDate,
      },
    })
    .from(profilesTable)
    .innerJoin(
      talkSpeakersTable,
      eq(profilesTable.id, talkSpeakersTable.speakerId),
    )
    .innerJoin(talksTable, eq(talkSpeakersTable.talkId, talksTable.id))
    .innerJoin(eventTalksTable, eq(talksTable.id, eventTalksTable.talkId))
    .innerJoin(eventsTable, eq(eventTalksTable.eventId, eventsTable.id))
    .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id))
    .where(and(eq(eventsTable.isDraft, false), lte(eventsTable.endDate, now)))
    .orderBy(
      asc(profilesTable.name),
      asc(profilesTable.id),
      desc(eventsTable.startDate),
      asc(eventsTable.id),
      asc(talksTable.id),
    );

  const speakers = new Map<
    string,
    {
      profile: typeof profilesTable.$inferSelect;
      image: typeof imagesTable.$inferSelect | null;
      talkIds: string[];
    }
  >();
  const talks = new Map<
    string,
    {
      id: string;
      title: string;
      description: string;
      speakerIds: string[];
      eventId: string;
      eventName: string;
      eventSlug: string;
      eventStart: Date;
    }
  >();

  for (const row of rows) {
    let speaker = speakers.get(row.profile.id);
    if (!speaker) {
      speaker = { profile: row.profile, image: row.image, talkIds: [] };
      speakers.set(row.profile.id, speaker);
    }
    if (!speaker.talkIds.includes(row.talk.id))
      speaker.talkIds.push(row.talk.id);
    // A talk may be presented at more than one event, with several speakers.
    const appearanceId = `${row.event.id}:${row.talk.id}`;
    let talk = talks.get(appearanceId);
    if (!talk) {
      talk = {
        id: row.talk.id,
        title: row.talk.title,
        description: row.talk.description,
        speakerIds: [],
        eventId: row.event.id,
        eventName: row.event.name,
        eventSlug: row.event.slug,
        eventStart: row.event.startDate,
      };
      talks.set(appearanceId, talk);
    }
    talk.speakerIds.push(row.profile.id);
  }
  return { speakers: [...speakers.values()], talks: [...talks.values()] };
}
