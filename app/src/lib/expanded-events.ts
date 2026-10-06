import { sanitizeRichText, type SafeHtml } from "@/lib/safe-html";
import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  eventsTable,
  imagesTable,
  hostsTable,
  talksTable,
  profilesTable,
  eventHostsTable,
  eventTalksTable,
  eventImagesTable,
  talkSpeakersTable,
} from "@/lib/schema";
import { Event, Image } from "@/lib/events";
import { getLumaUrl } from "@/lib/luma";
import { blankAvatar } from "@/lib/blank-avatar";

export type Host = {
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
  description: SafeHtml;
  speakers: Speaker[];
};

export type ExpandedEvent = Event & {
  talks: Talk[];
  hosts: Host[];
  images: Image[];
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
  // Whether the organizers set the venue is the syncs' business, not the
  // public API's.
  const { venueByOrganizer, ...event } = eventRow.events;
  const previewImage = eventRow.images || {
    url: "/hero-image-rocket.png",
    alt: `${event.name} preview`,
    placeholder: null,
    width: 1200,
    height: 630,
  };

  // Hosts
  const hostsPromise: Promise<Host[]> = (async () => {
    const darkLogos = alias(imagesTable, "dark_logos");
    const hostsQuery = await db
      .select({ host: hostsTable, light: imagesTable, dark: darkLogos })
      .from(eventHostsTable)
      .where(eq(eventHostsTable.eventId, event.id))
      .innerJoin(hostsTable, eq(eventHostsTable.hostId, hostsTable.id))
      .leftJoin(imagesTable, eq(hostsTable.squareLogoLight, imagesTable.id))
      .leftJoin(darkLogos, eq(hostsTable.squareLogoDark, darkLogos.id));

    return hostsQuery.map(({ host, light, dark }) => {
      // A host with one logo variant uses it for both; with none, the
      // brand's blank avatar.
      const fallback = blankAvatar(host.name);
      return {
        id: host.id,
        name: host.name,
        about: host.about,
        squareLogoLight: light ?? dark ?? fallback,
        squareLogoDark: dark ?? light ?? fallback,
      };
    });
  })();

  // Talks (with speakers)
  const talksPromise: Promise<Talk[]> = (async () => {
    const talksQuery = await db
      .select()
      .from(eventTalksTable)
      .where(eq(eventTalksTable.eventId, event.id))
      .leftJoin(talksTable, eq(eventTalksTable.talkId, talksTable.id))
      // The evening's running order; talks without a place follow, as attached.
      .orderBy(
        sql`${eventTalksTable.position} NULLS LAST`,
        asc(eventTalksTable.createdAt),
        asc(eventTalksTable.talkId),
      );

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

          const speakers: Speaker[] = speakersQuery
            .filter((speakerRow) => speakerRow.profiles)
            .map((speakerRow) => {
              const profile = speakerRow.profiles!;
              return {
                id: profile.id,
                name: profile.name,
                title: profile.title,
                image: speakerRow.images ?? blankAvatar(profile.name),
                bio: profile.bio,
                socials: {
                  twitter: profile.twitterHandle || undefined,
                  bluesky: profile.blueskyHandle || undefined,
                  linkedin: profile.linkedinHandle || undefined,
                },
              };
            });

          return {
            id: talk.id,
            title: talk.title,
            description: sanitizeRichText(talk.description),
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

    return imagesQuery.filter((row) => row.images).map((row) => row.images!);
  })();

  const [hosts, talks, images] = await Promise.all([
    hostsPromise,
    talksPromise,
    imagesPromise,
  ]);

  return {
    ...event,
    previewImage,
    lumaEventUrl: getLumaUrl(event.lumaEventId),
    talks,
    hosts,
    images,
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

/** An event as the public may see it: drafts are treated as missing. */
export async function getPublicEventBySlug(
  slug: string,
): Promise<ExpandedEvent | null> {
  const event = await getExpandedEventBySlug(slug);
  return event && !event.isDraft ? event : null;
}
