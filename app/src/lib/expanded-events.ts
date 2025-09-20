import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  eventsTable,
  imagesTable,
  sponsorsTable,
  talksTable,
  profilesTable,
  eventSponsorsTable,
  eventTalksTable,
  eventImagesTable,
  talkSpeakersTable,
  hacksTable,
  hackVotesTable,
} from "@/lib/schema";
import { Event, Image } from "@/lib/events";
import { getLumaUrl } from "@/lib/luma";
import { signImage, signImages } from "@/lib/image-signing";

export type Sponsor = {
  id: string;
  name: string;
  about: string;
  squareLogoLight: Image;
  squareLogoDark: Image;
};

export type Speaker = {
  id: string;
  name: string;
  title: string;
  image: Image;
  bio: string;
  socials: {
    twitter?: string;
    bluesky?: string;
    linkedin?: string;
  };
};

export type Talk = {
  id: string;
  title: string;
  description: string;
  speakers: Speaker[];
};

export type ExpandedEvent = Event & {
  talks: Talk[];
  sponsors: Sponsor[];
  images: Image[];
  hacks?: Array<{
    id: string;
    teamName: string;
    projectName?: string | null;
    projectDescription?: string | null;
    teamImage?: Image | null;
    voteCount: number;
  }>;
};

export async function getExpandedEventById(
  id: string,
): Promise<ExpandedEvent | null> {
  // Get the base event with preview image
  const eventQuery = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, id))
    .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
    .limit(1);

  if (eventQuery.length === 0) {
    return null;
  }

  return getExpandedEventFromQuery(eventQuery[0]);
}

async function getExpandedEventFromQuery(
  eventRow: any,
): Promise<ExpandedEvent> {
  const event = eventRow.events;
  const previewImageRaw = eventRow.images || {
    url: "/hero-image-rocket.png",
    alt: `${event.name} preview`,
    placeholder: null,
    width: 1200,
    height: 630,
  };
  const previewImagePromise = signImage(previewImageRaw);

  // Sponsors
  const sponsorsPromise: Promise<Sponsor[]> = (async () => {
    const sponsorsQuery = await db
      .select()
      .from(eventSponsorsTable)
      .where(eq(eventSponsorsTable.eventId, event.id))
      .leftJoin(
        sponsorsTable,
        eq(eventSponsorsTable.sponsorId, sponsorsTable.id),
      )
      .leftJoin(imagesTable, eq(sponsorsTable.squareLogoLight, imagesTable.id));

    return Promise.all(
      sponsorsQuery
        .filter((row) => row.sponsors)
        .map(async (row) => {
          const sponsor = row.sponsors!;
          const lightLogoRaw = row.images || {
            url: "/placeholder-sponsor.png",
            alt: sponsor.name,
            placeholder: null,
            width: 200,
            height: 200,
          };

          // Get dark logo separately
          const darkLogoQuery = await db
            .select()
            .from(imagesTable)
            .where(eq(imagesTable.id, sponsor.squareLogoDark!))
            .limit(1);

          const darkLogoRaw = darkLogoQuery[0] || lightLogoRaw;

          // Sign both logos
          const [lightLogo, darkLogo] = await Promise.all([
            signImage(lightLogoRaw),
            signImage(darkLogoRaw),
          ]);

          return {
            id: sponsor.id,
            name: sponsor.name,
            about: sponsor.about,
            squareLogoLight: lightLogo,
            squareLogoDark: darkLogo,
          };
        }),
    );
  })();

  // Talks (with speakers)
  const talksPromise: Promise<Talk[]> = (async () => {
    const talksQuery = await db
      .select()
      .from(eventTalksTable)
      .where(eq(eventTalksTable.eventId, event.id))
      .leftJoin(talksTable, eq(eventTalksTable.talkId, talksTable.id));

    return Promise.all(
      talksQuery
        .filter((row) => row.talks)
        .map(async (row) => {
          const talk = row.talks!;

          // Get speakers for this talk
          const speakersQuery = await db
            .select()
            .from(talkSpeakersTable)
            .where(eq(talkSpeakersTable.talkId, talk.id))
            .leftJoin(
              profilesTable,
              eq(talkSpeakersTable.speakerId, profilesTable.id),
            )
            .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id));

          const speakers: Speaker[] = await Promise.all(
            speakersQuery
              .filter((speakerRow) => speakerRow.profiles)
              .map(async (speakerRow) => {
                const profile = speakerRow.profiles!;
                const imageRaw = speakerRow.images || {
                  url: "/placeholder-avatar.png",
                  alt: profile.name,
                  placeholder: null,
                  width: 200,
                  height: 200,
                };

                const image = await signImage(imageRaw);

                return {
                  id: profile.id,
                  name: profile.name,
                  title: profile.title,
                  image,
                  bio: profile.bio,
                  socials: {
                    twitter: profile.twitterHandle || undefined,
                    bluesky: profile.blueskyHandle || undefined,
                    linkedin: profile.linkedinHandle || undefined,
                  },
                };
              }),
          );

          return {
            id: talk.id,
            title: talk.title,
            description: talk.description,
            speakers,
          };
        }),
    );
  })();

  // Event images
  const imagesPromise: Promise<Image[]> = (async () => {
    const imagesQuery = await db
      .select()
      .from(eventImagesTable)
      .where(eq(eventImagesTable.eventId, event.id))
      .leftJoin(imagesTable, eq(eventImagesTable.imageId, imagesTable.id));

    const imagesRaw: Image[] = imagesQuery
      .filter((row) => row.images)
      .map((row) => row.images!);

    return signImages(imagesRaw);
  })();

  // Hacks (only for hackathons)
  const hacksPromise: Promise<ExpandedEvent["hacks"]> = event.isHackathon
    ? (async () => {
        const baseHacksQuery = await db
          .select()
          .from(hacksTable)
          .where(eq(hacksTable.eventId, event.id))
          .leftJoin(imagesTable, eq(hacksTable.teamImage, imagesTable.id));
        if (baseHacksQuery.length === 0) return [];

        const hackIds = baseHacksQuery.map((row) => row.hacks.id);
        const allVotes = await db
          .select({ hackId: hackVotesTable.hackId })
          .from(hackVotesTable)
          .where(inArray(hackVotesTable.hackId, hackIds));

        const voteCountByHack: Record<string, number> = {};
        for (const v of allVotes) {
          const id = (v as any).hackId as string;
          voteCountByHack[id] = (voteCountByHack[id] ?? 0) + 1;
        }

        return Promise.all(
          baseHacksQuery.map(async (row) => {
            const hack = row.hacks;
            const img = row.images;
            const signed = img
              ? await signImage({
                  url: img.url,
                  alt: img.alt,
                  placeholder: img.placeholder,
                  width: img.width,
                  height: img.height,
                })
              : null;
            return {
              id: hack.id,
              teamName:
                (hack as any).teamName ??
                (hack as any).team_name ??
                (hack as any).name,
              projectName:
                (hack as any).projectName ?? (hack as any).project_name ?? null,
              projectDescription:
                (hack as any).projectDescription ??
                (hack as any).project_description ??
                null,
              teamImage: signed,
              voteCount: voteCountByHack[hack.id] ?? 0,
            };
          }),
        );
      })()
    : Promise.resolve(undefined);

  const [previewImage, sponsors, talks, images, hacks] = await Promise.all([
    previewImagePromise,
    sponsorsPromise,
    talksPromise,
    imagesPromise,
    hacksPromise,
  ]);

  return {
    ...event,
    previewImage,
    lumaEventUrl: getLumaUrl(event.lumaEventId),
    talks,
    sponsors,
    images,
    hacks,
  };
}

export async function getExpandedEventBySlug(
  slug: string,
): Promise<ExpandedEvent | null> {
  // Get the base event with preview image
  const eventQuery = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.slug, slug))
    .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
    .limit(1);

  if (eventQuery.length === 0) {
    return null;
  }

  return getExpandedEventFromQuery(eventQuery[0]);
}
