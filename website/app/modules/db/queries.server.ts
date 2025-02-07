import { eq, and, gte, lt } from 'drizzle-orm';
import { DatabaseClient } from './client.server';
import {
  eventsTable,
  eventSponsorsTable,
  eventTalksTable,
  eventImagesTable,
  sponsorsTable,
  talksTable,
  profilesTable,
  redirectsTable,
  imagesTable,
} from './schema.server';

type Deps = {
  db: DatabaseClient;
};

export const createQueryClient = ({ db }: Deps) => {
  const getEvents = async () => {
    return db.select().from(eventsTable).where(eq(eventsTable.isDraft, false));
  };

  const getUpcomingEvents = async () => {
    return db
      .select()
      .from(eventsTable)
      .where(and(gte(eventsTable.endDate, new Date()), eq(eventsTable.isDraft, false)))
      .orderBy(eventsTable.startDate);
  };

  const getPastEvents = async () => {
    return db.select().from(eventsTable).where(lt(eventsTable.endDate, new Date())).orderBy(eventsTable.startDate);
  };

  const getEventBySlug = async (slug: string) => {
    const event = await db.select().from(eventsTable).where(eq(eventsTable.slug, slug)).limit(1);
    return event.length > 0 ? event[0] : null;
  };

  const getSponsors = async () => {
    return db.select().from(sponsorsTable);
  };

  const getLinks = async () => {
    return db.select().from(redirectsTable);
  };

  const getEventByLumaEventId = async (lumaEventId: string) => {
    const event = await db.select().from(eventsTable).where(eq(eventsTable.lumaEventId, lumaEventId)).limit(1);
    return event.length > 0 ? event[0] : null;
  };

  const getSpeakers = async () => {
    return db.select().from(profilesTable).where(eq(profilesTable.profileType, 'organizer'));
  };

  const getTalks = async () => {
    return db.select().from(talksTable);
  };

  const getExpandedEventBySlug = async (slug: string) => {
    const event = await db.select().from(eventsTable).where(eq(eventsTable.slug, slug)).limit(1);

    if (event.length === 0) return null;

    const eventId = event[0].id;

    const sponsors = await db
      .select({ sponsorId: sponsorsTable.id, name: sponsorsTable.name, about: sponsorsTable.about })
      .from(eventSponsorsTable)
      .where(eq(eventSponsorsTable.eventId, eventId))
      .innerJoin(sponsorsTable, eq(eventSponsorsTable.sponsorId, sponsorsTable.id));

    const talks = await db
      .select({ talkId: talksTable.id, title: talksTable.title, description: talksTable.description })
      .from(eventTalksTable)
      .where(eq(eventTalksTable.eventId, eventId))
      .innerJoin(talksTable, eq(eventTalksTable.talkId, talksTable.id));

    const photos = await db
      .select({ imageId: imagesTable.id, url: imagesTable.url })
      .from(eventImagesTable)
      .where(eq(eventImagesTable.eventId, eventId))
      .innerJoin(imagesTable, eq(eventImagesTable.imageId, imagesTable.id));

    return {
      ...event[0],
      sponsors,
      talks,
      photos,
    };
  };

  const getPocketbaseUrlForImage = (imageId: string, thumb?: { width: number; height: number }) => {
    const searchParams = new URLSearchParams();
    if (thumb) {
      searchParams.set('thumb', `${thumb.width}x${thumb.height}`);
    }
    return `/api/files${imageId}?${searchParams.toString()}`;
  };

  return {
    getEvents,
    getUpcomingEvents,
    getPastEvents,
    getEventBySlug,
    getExpandedEventBySlug,
    getEventByLumaEventId,
    getSpeakers,
    getTalks,
    getSponsors,
    getLinks,
    getPocketbaseUrlForImage,
  };
};
