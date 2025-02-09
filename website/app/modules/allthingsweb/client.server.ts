import { DbQueryClient } from "../db/queries.server";
import { SpeakerWithTalkIds, TalkWithEventCtx } from "./speakers";
import { Profile } from "./profiles";
import { Event, ExpandedEvent, ExpandedTalk, Sponsor } from "./events";
import { RedirectLink } from "./redirects";
import { S3Client } from "../s3/client.server";
import { MainConfig } from "~/config.server";
import { Image } from "./images";

type Deps = {
  dbQueryClient: DbQueryClient;
  s3Client: S3Client;
  mainConfig: MainConfig;
};

async function presignImage(image: Image, deps: Deps): Promise<Image> {
  if (image.url.startsWith(deps.mainConfig.s3.url)) {
    image.url = await deps.s3Client.presign(image.url);
  }
  return image;
}

async function presignPreviewImages(
  events: Event[],
  deps: Deps,
): Promise<Event[]> {
  return Promise.all(
    events.map(async (event) => {
      event.previewImage = await presignImage(event.previewImage, deps);
      return event;
    }),
  );
}

async function presignPreviewImage(event: Event, deps: Deps): Promise<Event> {
  event.previewImage = await presignImage(event.previewImage, deps);
  return event;
}

async function presignObjImage<T extends { image: Image }>(
  obj: T,
  deps: Deps,
): Promise<T> {
  obj.image = await presignImage(obj.image, deps);
  return obj;
}

async function presignSponsorImages(
  sponsor: Sponsor,
  deps: Deps,
): Promise<Sponsor> {
  sponsor.squareLogoDark = await presignImage(sponsor.squareLogoDark, deps);
  sponsor.squareLogoLight = await presignImage(sponsor.squareLogoLight, deps);
  return sponsor;
}

export type QueryClient = ReturnType<typeof createQueryClient>;

export const createQueryClient = ({
  dbQueryClient,
  s3Client,
  mainConfig,
}: Deps) => {
  const getAllEvents = async (): Promise<Event[]> => {
    const results = await dbQueryClient.queryPublishedEvents();
    const events = dbQueryClient.toEvents(results);
    return presignPreviewImages(events, {
      dbQueryClient,
      s3Client,
      mainConfig,
    });
  };

  const getPublishedEvents = async (): Promise<Event[]> => {
    const results = await dbQueryClient.queryPublishedEvents();
    const events = dbQueryClient.toEvents(results);
    return presignPreviewImages(events, {
      dbQueryClient,
      s3Client,
      mainConfig,
    });
  };

  const getPublishedUpcomingEvents = async (): Promise<Event[]> => {
    const results = await dbQueryClient.queryPublishedUpcomingEvents();
    const events = dbQueryClient.toEvents(results);
    return presignPreviewImages(events, {
      dbQueryClient,
      s3Client,
      mainConfig,
    });
  };

  const getPublishedPastEvents = async (): Promise<Event[]> => {
    const results = await dbQueryClient.queryPublishedPastEvents();
    const events = dbQueryClient.toEvents(results);
    return presignPreviewImages(events, {
      dbQueryClient,
      s3Client,
      mainConfig,
    });
  };

  const getEventById = async (id: string): Promise<Event | null> => {
    const results = await dbQueryClient.queryEventById(id);
    const event = dbQueryClient.toEvent(results);
    if (!event) {
      return null;
    }
    return presignPreviewImage(event, { dbQueryClient, s3Client, mainConfig });
  };

  const getEventBySlug = async (slug: string): Promise<Event | null> => {
    const results = await dbQueryClient.queryEventBySlug(slug);
    const event = dbQueryClient.toEvent(results);
    if (!event) {
      return null;
    }
    return presignPreviewImage(event, { dbQueryClient, s3Client, mainConfig });
  };

  const getRedirectLink = async (
    slug: string,
  ): Promise<RedirectLink | null> => {
    const results = await dbQueryClient.queryRedirectBySlug(slug);
    return dbQueryClient.toRedirectLink(results);
  };

  const getExpandedEventBySlug = async (
    slug: string,
  ): Promise<ExpandedEvent | null> => {
    let eventData = await getEventBySlug(slug);
    if (!eventData) {
      return null;
    }
    const talksQuery = dbQueryClient.queryTalksByEventId(eventData.id);
    const speakersQuery = dbQueryClient.querySpeakersByEventId(eventData.id);
    const sponsorsQuery = dbQueryClient.querySponsorsByEventId(eventData.id);
    const imagesQuery = dbQueryClient.queryEventImagesByEventId(eventData.id);

    const [event, talksData, speakersData, sponsorsData, imagesData] =
      await Promise.all([
        presignPreviewImage(eventData, { dbQueryClient, s3Client, mainConfig }),
        talksQuery,
        speakersQuery,
        sponsorsQuery,
        imagesQuery,
      ]);
    const talks = dbQueryClient.toTalks(talksData);
    const speakers = await Promise.all(
      dbQueryClient.toSpeakers(speakersData).map((speaker) => {
        return presignObjImage(speaker, {
          dbQueryClient,
          s3Client,
          mainConfig,
        });
      }),
    );
    const sponsors = await Promise.all(
      dbQueryClient.toSponsors(sponsorsData).map((sponsor) => {
        return presignSponsorImages(sponsor, {
          dbQueryClient,
          s3Client,
          mainConfig,
        });
      }),
    );
    const images = await Promise.all(
      dbQueryClient.toImages(imagesData).map((image) => {
        return presignImage(image, { dbQueryClient, s3Client, mainConfig });
      }),
    );

    const expandedTalks: ExpandedTalk[] = talks.map((talk) => {
      const talkSpeakers = speakers.filter(
        (speaker) => speaker.talkId === talk.id,
      );
      return {
        ...talk,
        speakers: talkSpeakers,
      } satisfies ExpandedTalk;
    });

    return {
      ...event,
      talks: expandedTalks,
      sponsors,
      images,
    } satisfies ExpandedEvent;
  };

  const getSpeakerProfiles = async (): Promise<Profile[]> => {
    const results = await dbQueryClient.querySpeakers();
    const profiles = await Promise.all(
      dbQueryClient.toSpeakerProfiles(results).map((profile) => {
        return presignObjImage(profile, {
          dbQueryClient,
          s3Client,
          mainConfig,
        });
      }),
    );
    return profiles;
  };

  const getSpeakersWithTalks = async (): Promise<{
    speakers: SpeakerWithTalkIds[];
    talks: TalkWithEventCtx[];
  }> => {
    const speakersQuery = dbQueryClient.querySpeakers();
    const talksQuery = dbQueryClient.queryTalksWithEventCtx();
    const speakerTalksQuery = dbQueryClient.querySpeakerTalks();

    const [speakersData, talksData, speakerTalksData] = await Promise.all([
      speakersQuery,
      talksQuery,
      speakerTalksQuery,
    ]);

    const speakersWithTalks = await Promise.all(
      dbQueryClient
        .toSpeakersWithTalks(speakersData, speakerTalksData)
        .map((speakerWithTalks) =>
          presignObjImage(speakerWithTalks, {
            dbQueryClient,
            s3Client,
            mainConfig,
          }),
        ),
    );
    const talksWithEventCtx = dbQueryClient.toTalkWithEventCtx(talksData);
    return {
      speakers: speakersWithTalks,
      talks: talksWithEventCtx,
    };
  };

  const getOrganizers = async (): Promise<Profile[]> => {
    const organizerProfiles = await dbQueryClient.queryOrganizers();
    return Promise.all(
      dbQueryClient.toProfiles(organizerProfiles).map((profile) => {
        return presignObjImage(profile, {
          dbQueryClient,
          s3Client,
          mainConfig,
        });
      }),
    );
  };

  return {
    getAllEvents,
    getPublishedEvents,
    getPublishedUpcomingEvents,
    getPublishedPastEvents,
    getEventById,
    getEventBySlug,
    getExpandedEventBySlug,
    getRedirectLink,
    getSpeakersWithTalks,
    getOrganizers,
    getSpeakerProfiles,
  };
};
