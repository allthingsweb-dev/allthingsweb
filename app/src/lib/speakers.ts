import { eq, and } from "drizzle-orm";
import { db } from "./db";
import {
  profilesTable,
  imagesTable,
  talksTable,
  talkSpeakersTable,
  eventTalksTable,
  eventsTable,
} from "./schema";
import { Profile, getSocialUrls } from "./profiles";
import { createS3Client } from "./s3";
import { mainConfig } from "./config";

export type Talk = {
  id: string;
  title: string;
  description: string | null;
  speakerId: string;
  eventId: string;
};

export type TalkWithEventCtx = Talk & {
  eventName: string;
  eventSlug: string;
  eventStart: Date;
};

export type SpeakerWithTalkIds = Profile & {
  talkIds: string[];
};

async function presignImageUrl(imageUrl: string): Promise<string> {
  // Check if URL is from S3 (contains the S3 URL from config)
  if (imageUrl.includes(mainConfig.s3.url)) {
    const s3Client = createS3Client({ mainConfig });
    return s3Client.presign(imageUrl);
  }
  // Return original URL if not from S3
  return imageUrl;
}

export async function getSpeakersWithTalks(): Promise<{
  speakers: SpeakerWithTalkIds[];
  talks: TalkWithEventCtx[];
}> {
  // Get all speakers (profiles that have talks)
  const speakersQuery = await db
    .select({
      profile: profilesTable,
      image: imagesTable,
      talkId: talkSpeakersTable.talkId,
    })
    .from(profilesTable)
    .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id))
    .innerJoin(
      talkSpeakersTable,
      eq(profilesTable.id, talkSpeakersTable.speakerId),
    )
    .where(eq(profilesTable.profileType, "member"));

  // Get all talks with event context
  const talksQuery = await db
    .select({
      talk: talksTable,
      event: eventsTable,
      speakerId: talkSpeakersTable.speakerId,
    })
    .from(talksTable)
    .innerJoin(talkSpeakersTable, eq(talksTable.id, talkSpeakersTable.talkId))
    .innerJoin(eventTalksTable, eq(talksTable.id, eventTalksTable.talkId))
    .innerJoin(eventsTable, eq(eventTalksTable.eventId, eventsTable.id))
    .where(eq(eventsTable.isDraft, false));

  // Group speakers and their talk IDs
  const speakersMap = new Map<
    string,
    {
      profile: any;
      image: any;
      talkIds: string[];
    }
  >();

  speakersQuery.forEach((row) => {
    const speakerId = row.profile.id;
    if (!speakersMap.has(speakerId)) {
      speakersMap.set(speakerId, {
        profile: row.profile,
        image: row.image,
        talkIds: [],
      });
    }
    speakersMap.get(speakerId)!.talkIds.push(row.talkId);
  });

  // Convert to final format and presign image URLs
  const speakersWithPresignedImages = await Promise.all(
    Array.from(speakersMap.values()).map(
      async (speakerData): Promise<SpeakerWithTalkIds> => {
        const profile = speakerData.profile;
        const image = speakerData.image || {
          url: "/hero-image-rocket.png",
          alt: `${profile.name} profile picture`,
          placeholder: null,
          width: 400,
          height: 400,
        };

        // Presign the image URL if it's from S3
        const presignedImageUrl = await presignImageUrl(image.url);

        return {
          id: profile.id,
          name: profile.name,
          image: {
            ...image,
            url: presignedImageUrl,
          },
          title: profile.title,
          bio: profile.bio,
          type: profile.profileType,
          socials: getSocialUrls({
            twitterHandle: profile.twitterHandle,
            linkedinHandle: profile.linkedinHandle,
            blueskyHandle: profile.blueskyHandle,
          }),
          talkIds: speakerData.talkIds,
        };
      },
    ),
  );

  // Deduplicate talks (since a talk can have multiple speakers, it appears multiple times in talksQuery)
  const talksMap = new Map<string, TalkWithEventCtx>();
  
  talksQuery.forEach((row) => {
    if (!talksMap.has(row.talk.id)) {
      talksMap.set(row.talk.id, {
        id: row.talk.id,
        title: row.talk.title,
        description: row.talk.description,
        speakerId: row.speakerId, // This will be the first speaker found, but it's not used in the UI
        eventId: row.event.id,
        eventName: row.event.name,
        eventSlug: row.event.slug,
        eventStart: row.event.startDate,
      });
    }
  });
  
  const talks: TalkWithEventCtx[] = Array.from(talksMap.values());

  return { speakers: speakersWithPresignedImages, talks };
}
