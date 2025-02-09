import { eq, and, gte, lt, aliasedTable, desc } from "drizzle-orm";
import { Speaker, Sponsor, Talk } from "../allthingsweb/events";
import { Event } from "../allthingsweb/events";
import { getSocialUrls } from "../allthingsweb/socials";
import { RedirectLink } from "../allthingsweb/redirects";
import { getDefaultPreviewImage } from "../allthingsweb/events.server";
import { SpeakerWithTalkIds, TalkWithEventCtx } from "../allthingsweb/speakers";
import { Image } from "../allthingsweb/images";
import { DatabaseClient } from "./client.server";
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
  talkSpeakersTable,
} from "./schema.server";
import { getLumaUrl } from "../luma/utils";
import { MainConfig } from "~/config.server";
import { Profile } from "../allthingsweb/profiles";

type Awaited<T> = T extends PromiseLike<infer U> ? U : T;

type Deps = {
  db: DatabaseClient;
  mainConfig: MainConfig;
};

export type DbQueryClient = ReturnType<typeof createDbQueryClient>;

export const createDbQueryClient = ({ db, mainConfig }: Deps) => {
  function toEvents(
    queryResult: Awaited<ReturnType<typeof queryEvents>>,
  ): Event[] {
    return queryResult.map((row) => {
      const { events: event, images: previewImage } = row;
      return {
        ...event,
        previewImage:
          previewImage ??
          getDefaultPreviewImage(event.name, event.slug, mainConfig.origin),
        lumaEventUrl: getLumaUrl(event.lumaEventId),
      };
    });
  }

  function toEvent(
    queryResult: Awaited<ReturnType<typeof queryEventById>>,
  ): Event | null {
    if (queryResult.length === 0) {
      return null;
    }
    const { events: event, images: previewImage } = queryResult[0];
    return {
      ...event,
      previewImage:
        previewImage ??
        getDefaultPreviewImage(event.name, event.slug, mainConfig.origin),
      lumaEventUrl: getLumaUrl(event.lumaEventId),
    };
  }

  function toTalks(
    queryResult: Awaited<ReturnType<typeof queryTalksByEventId>>,
  ): Talk[] {
    return queryResult.map((row) => {
      const { talks: talk } = row;
      return talk;
    });
  }

  function toSpeakers(
    queryResult: Awaited<ReturnType<typeof querySpeakersByEventId>>,
  ): Speaker[] {
    return queryResult.map((row) => {
      const { profiles: speaker, images: image, talk_speakers: talk } = row;
      if (!image) {
        throw new Error("Missing profile image");
      }
      return {
        ...speaker,
        socials: getSocialUrls(speaker),
        type: speaker.profileType,
        image,
        talkId: talk.talkId,
      };
    });
  }

  function toSponsors(
    queryResult: Awaited<ReturnType<typeof querySponsorsByEventId>>,
  ): Sponsor[] {
    return queryResult.map((row) => {
      const {
        sponsors: sponsor,
        darkImage: squareLogoDark,
        lightImage: squareLogoLight,
      } = row;
      if (!squareLogoLight || !squareLogoDark) {
        throw new Error("Missing squareLogoLight or squareLogoDark image");
      }
      return {
        ...sponsor,
        squareLogoLight,
        squareLogoDark,
      };
    });
  }

  function toImages(
    queryResult: Awaited<ReturnType<typeof queryEventImagesByEventId>>,
  ): Image[] {
    return queryResult.map((row) => {
      const { images: image } = row;
      return image;
    });
  }

  function toRedirectLink(
    queryResult: Awaited<ReturnType<typeof queryRedirectBySlug>>,
  ): RedirectLink | null {
    if (queryResult.length === 0) {
      return null;
    }
    const redirect = queryResult[0];
    return {
      slug: redirect.slug,
      destinationUrl: redirect.destinationUrl,
    };
  }

  function toTalkWithEventCtx(
    queryResult: Awaited<ReturnType<typeof queryTalksWithEventCtx>>,
  ): TalkWithEventCtx[] {
    return queryResult.map((row) => {
      const { talks: talk, events: event } = row;
      return {
        ...talk,
        eventName: event.name,
        eventSlug: event.slug,
        eventStart: event.startDate,
      };
    });
  }

  function toSpeakersWithTalks(
    speakersQueryResult: Awaited<ReturnType<typeof querySpeakers>>,
    speakerTalksQueryResult: Awaited<ReturnType<typeof querySpeakerTalks>>,
  ): SpeakerWithTalkIds[] {
    const speakerTalks = speakerTalksQueryResult.reduce(
      (acc, row) => {
        acc[row.speakerId] = acc[row.speakerId] || [];
        acc[row.speakerId].push(row.talkId);
        return acc;
      },
      {} as Record<string, string[]>,
    );
    return speakersQueryResult.map(({ profiles, images: image }) => {
      if (!image) {
        throw new Error("Missing profile image");
      }
      return {
        ...profiles,
        type: profiles.profileType,
        socials: getSocialUrls(profiles),
        image,
        talkIds: speakerTalks[profiles.id] || [],
      };
    });
  }

  function toProfiles(
    queryResult: Awaited<ReturnType<typeof queryOrganizers>>,
  ): Profile[] {
    return queryResult.map((row) => {
      const { profiles: profile, images: image } = row;
      if (!image) {
        throw new Error("Missing profile image");
      }
      return {
        ...profile,
        socials: getSocialUrls(profile),
        type: profile.profileType,
        image,
      };
    });
  }

  function toSpeakerProfiles(
    queryResult: Awaited<ReturnType<typeof querySpeakers>>,
  ): Profile[] {
    return queryResult.map((row) => {
      const { profiles: speaker, images: image } = row;
      if (!image) {
        throw new Error("Missing profile image");
      }
      return {
        ...speaker,
        socials: getSocialUrls(speaker),
        type: speaker.profileType,
        image,
      };
    });
  }

  function queryEvents() {
    return db
      .select()
      .from(eventsTable)
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .orderBy(desc(eventsTable.startDate));
  }

  function queryPublishedEvents() {
    return db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.isDraft, false))
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .orderBy(desc(eventsTable.startDate));
  }

  function queryPublishedUpcomingEvents() {
    return db
      .select()
      .from(eventsTable)
      .where(
        and(
          gte(eventsTable.endDate, new Date()),
          eq(eventsTable.isDraft, false),
        ),
      )
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .orderBy(desc(eventsTable.startDate));
  }

  function queryPublishedPastEvents() {
    return db
      .select()
      .from(eventsTable)
      .where(
        and(
          lt(eventsTable.endDate, new Date()),
          eq(eventsTable.isDraft, false),
        ),
      )
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .orderBy(desc(eventsTable.startDate));
  }

  function queryEventById(id: string) {
    return db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id));
  }

  function queryEventBySlug(slug: string) {
    return db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.slug, slug))
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id));
  }

  function queryTalksByEventId(eventId: string) {
    return db
      .select()
      .from(eventTalksTable)
      .where(eq(eventTalksTable.eventId, eventId))
      .innerJoin(talksTable, eq(eventTalksTable.talkId, talksTable.id));
  }

  function querySpeakersByEventId(eventId: string) {
    return db
      .select()
      .from(eventTalksTable)
      .where(eq(eventTalksTable.eventId, eventId))
      .innerJoin(talksTable, eq(eventTalksTable.talkId, talksTable.id))
      .innerJoin(talkSpeakersTable, eq(talkSpeakersTable.talkId, talksTable.id))
      .innerJoin(
        profilesTable,
        eq(talkSpeakersTable.speakerId, profilesTable.id),
      )
      .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id));
  }

  function querySponsorsByEventId(eventId: string) {
    const imagesTableLight = aliasedTable(imagesTable, "imagesTableLight");
    const imagesTableDark = aliasedTable(imagesTable, "imagesTableDark");
    return db
      .select({
        sponsors: {
          id: sponsorsTable.id,
          name: sponsorsTable.name,
          about: sponsorsTable.about,
        },
        darkImage: {
          url: imagesTableDark.url,
          alt: imagesTableDark.alt,
          placeholder: imagesTableDark.placeholder,
        },
        lightImage: {
          url: imagesTableLight.url,
          alt: imagesTableLight.alt,
          placeholder: imagesTableLight.placeholder,
        },
      })
      .from(eventSponsorsTable)
      .where(eq(eventSponsorsTable.eventId, eventId))
      .innerJoin(
        sponsorsTable,
        eq(eventSponsorsTable.sponsorId, sponsorsTable.id),
      )
      .leftJoin(
        imagesTableLight,
        eq(sponsorsTable.squareLogoLight, imagesTableLight.id),
      )
      .leftJoin(
        imagesTableDark,
        eq(sponsorsTable.squareLogoDark, imagesTableDark.id),
      );
  }

  function queryEventImagesByEventId(eventId: string) {
    return db
      .select()
      .from(eventImagesTable)
      .where(eq(eventImagesTable.eventId, eventId))
      .innerJoin(imagesTable, eq(eventImagesTable.imageId, imagesTable.id));
  }

  function queryRedirectBySlug(slug: string) {
    return db
      .select()
      .from(redirectsTable)
      .where(eq(redirectsTable.slug, slug));
  }

  function querySpeakers() {
    return db
      .select()
      .from(profilesTable)
      .innerJoin(
        talkSpeakersTable,
        eq(profilesTable.id, talkSpeakersTable.speakerId),
      )
      .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id));
  }

  function querySpeakerTalks() {
    return db.select().from(talkSpeakersTable);
  }

  function queryTalksWithEventCtx() {
    return db
      .select()
      .from(talksTable)
      .innerJoin(eventTalksTable, eq(talksTable.id, eventTalksTable.talkId))
      .innerJoin(eventsTable, eq(eventTalksTable.eventId, eventsTable.id));
  }

  function queryOrganizers() {
    return db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.profileType, "organizer"))
      .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id));
  }

  return {
    toEvents,
    toEvent,
    toTalks,
    toSpeakers,
    toSponsors,
    toImages,
    toRedirectLink,
    toTalkWithEventCtx,
    toSpeakersWithTalks,
    toProfiles,
    toSpeakerProfiles,
    queryEvents,
    queryPublishedEvents,
    queryPublishedUpcomingEvents,
    queryPublishedPastEvents,
    queryEventById,
    queryEventBySlug,
    queryTalksByEventId,
    querySpeakersByEventId,
    querySponsorsByEventId,
    queryEventImagesByEventId,
    queryRedirectBySlug,
    querySpeakers,
    querySpeakerTalks,
    queryTalksWithEventCtx,
    queryOrganizers,
  };
};
