import { S3Client } from "bun";
import { buildContainer } from "~/modules/container.server";
import {
  eventImagesTable,
  eventSponsorsTable,
  eventTalksTable,
  eventsTable,
  imagesTable,
  InsertEvent,
  InsertProfile,
  InsertSponsor,
  InsertTalk,
  profilesTable,
  sponsorsTable,
  talkSpeakersTable,
  talksTable,
} from "@lib/db/schema.server";
import { randomUUID } from "node:crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/bun";
import { and, eq } from "drizzle-orm";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LumaEventPayload } from "~/modules/luma/api.server";

// Enhanced event types that accept string dates
export interface CreateEventInput {
  name: string;
  slug: string;
  attendeeLimit: number;
  tagline: string;
  startDate: string | Date;
  endDate: string | Date;
  lumaEventId?: string;
  isDraft?: boolean;
  isHackathon?: boolean;
  highlightOnLandingPage?: boolean;
  fullAddress?: string;
  shortLocation?: string;
  streetAddress?: string;
}

export interface UpdateEventInput {
  name?: string;
  slug?: string;
  attendeeLimit?: number;
  tagline?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  lumaEventId?: string;
  isDraft?: boolean;
  isHackathon?: boolean;
  highlightOnLandingPage?: boolean;
  fullAddress?: string;
  shortLocation?: string;
  streetAddress?: string;
  recordingUrl?: string;
}

// Helper function to ensure dates are Date objects
function ensureDate(date: string | Date): Date {
  if (typeof date === 'string') {
    return new Date(date);
  }
  return date;
}

// Helper function to convert CreateEventInput to InsertEvent
function prepareEventForInsert(event: CreateEventInput): InsertEvent {
  return {
    ...event,
    startDate: ensureDate(event.startDate),
    endDate: ensureDate(event.endDate),
  };
}

// Helper function to convert UpdateEventInput to Partial<InsertEvent>
function prepareEventForUpdate(eventData: UpdateEventInput): Partial<InsertEvent> {
  const { startDate, endDate, ...rest } = eventData;
  const prepared: Partial<InsertEvent> = { ...rest };
  
  if (startDate) {
    prepared.startDate = ensureDate(startDate);
  }
  
  if (endDate) {
    prepared.endDate = ensureDate(endDate);
  }
  
  return prepared;
}

// Event functions
export async function createEvent(event: CreateEventInput) {
  const container = buildContainer();
  const preparedEvent = prepareEventForInsert(event);
  const res = await container.cradle.db
    .insert(eventsTable)
    .values(preparedEvent)
    .returning();
  return res[0];
}

export async function getEventBySlug(slug: string) {
  const container = buildContainer();
  const event = await container.cradle.queryClient.getEventBySlug(slug);
  return event;
}

export async function updateEvent(slug: string, eventData: UpdateEventInput) {
  const container = buildContainer();
  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }
  const preparedEventData = prepareEventForUpdate(eventData);
  const res = await container.cradle.db
    .update(eventsTable)
    .set(preparedEventData)
    .where(eq(eventsTable.id, event.id))
    .returning();
  return res[0];
}

// Profile functions
export async function findProfileByName(name: string) {
  const container = buildContainer();
  const db = container.cradle.db;
  const profile = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, name));
  return profile[0];
}

export async function createProfile(profile: InsertProfile, imgPath: string) {
  const container = buildContainer();

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

  const uuid = randomUUID();
  const file = Bun.file(imgPath);
  const buffer = await file.bytes();
  const { width, height, format } = await getImgMetadata(buffer);
  const nameSlug = profile.name.toLowerCase().replace(/ /g, "-");
  const path = "profiles/" + nameSlug + "-" + uuid + "." + format;
  const placeholder = await getImgPlaceholder(buffer);
  await bunS3Client.write(path, buffer);
  const url = `${container.cradle.mainConfig.s3.url}/${path}`;
  await container.cradle.db.insert(imagesTable).values({
    url,
    id: uuid,
    width,
    height,
    placeholder,
    alt: `${profile.name} smiling into the camera`,
  });

  profile.image = uuid;
  const profileRes = await container.cradle.db
    .insert(profilesTable)
    .values(profile)
    .returning();
  
  return profileRes[0];
}

export async function replaceProfileImage(name: string, imgPath: string) {
  const container = buildContainer();

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

  const [profile] = await container.cradle.db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, name));
  if (!profile) {
    throw new Error("Profile not found");
  }

  const imageToDeleteId = profile.image;
  if (!imageToDeleteId) {
    throw new Error("No image to delete");
  }
  const [imageToDelete] = await container.cradle.db
    .select()
    .from(imagesTable)
    .where(eq(imagesTable.id, imageToDeleteId));
  if (!imageToDelete) {
    throw new Error("Image to delete not found");
  }

  const uuid = randomUUID();
  const file = Bun.file(imgPath);
  const buffer = await file.bytes();
  const { width, height, format } = await getImgMetadata(buffer);
  const nameSlug = profile.name.toLowerCase().replace(/ /g, "-");
  const path = "profiles/" + nameSlug + "-" + uuid + "." + format;
  const placeholder = await getImgPlaceholder(buffer);
  await bunS3Client.write(path, buffer);
  const url = `${container.cradle.mainConfig.s3.url}/${path}`;
  await container.cradle.db.insert(imagesTable).values({
    url,
    id: uuid,
    width,
    height,
    placeholder,
    alt: `${profile.name} smiling into the camera`,
  });

  await container.cradle.db
    .update(profilesTable)
    .set({
      image: uuid,
    })
    .where(eq(profilesTable.id, profile.id));

  await container.cradle.db
    .delete(imagesTable)
    .where(eq(imagesTable.id, imageToDeleteId));

  const s3Path = imageToDelete.url.replace(
    container.cradle.mainConfig.s3.url + "/",
    "",
  );
  await bunS3Client.delete(s3Path);

  return profile;
}

export async function updateProfile(name: string, profileData: Partial<InsertProfile>) {
  const container = buildContainer();
  const [profile] = await container.cradle.db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, name));
  if (!profile) {
    throw new Error("Profile not found");
  }
  const res = await container.cradle.db
    .update(profilesTable)
    .set(profileData)
    .where(eq(profilesTable.id, profile.id))
    .returning();
  return res[0];
}

export async function updateProfileById(id: string, profileData: Partial<InsertProfile>) {
  const container = buildContainer();
  const res = await container.cradle.db
    .update(profilesTable)
    .set(profileData)
    .where(eq(profilesTable.id, id))
    .returning();
  if (!res[0]) {
    throw new Error("Profile not found");
  }
  return res[0];
}

// Talk functions
export async function createTalk(talk: InsertTalk, speakerIds: string[]) {
  const container = buildContainer();

  const talkRes = await container.cradle.db
    .insert(talksTable)
    .values(talk)
    .returning();
  if (!talkRes[0]) {
    throw new Error("Failed to create talk");
  }
  
  const talkSpeakerResults = [];
  for (const speakerId of speakerIds) {
    const talkSpeakerRes = await container.cradle.db
      .insert(talkSpeakersTable)
      .values({
        talkId: talkRes[0].id,
        speakerId,
      })
      .returning();
    talkSpeakerResults.push(talkSpeakerRes[0]);
  }
  
  return { talk: talkRes[0], speakers: talkSpeakerResults };
}

export async function addTalkToEvent(slug: string, talkId: string) {
  const container = buildContainer();

  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }

  await container.cradle.db.insert(eventTalksTable).values({
    eventId: event.id,
    talkId,
  });
  
  return event;
}

export async function removeTalkFromEvent(slug: string, talkId: string) {
  const container = buildContainer();

  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }

  const result = await container.cradle.db
    .delete(eventTalksTable)
    .where(
      and(
        eq(eventTalksTable.talkId, talkId),
        eq(eventTalksTable.eventId, event.id),
      ),
    )
    .returning();
  
  return result;
}

export async function findTalksBySpeakerName(speakerName: string) {
  const container = buildContainer();
  const db = container.cradle.db;
  
  const [speaker] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, speakerName));
  
  if (!speaker) {
    throw new Error("Speaker not found");
  }
  
  const talks = await db
    .select()
    .from(talkSpeakersTable)
    .leftJoin(talksTable, eq(talkSpeakersTable.talkId, talksTable.id))
    .where(eq(talkSpeakersTable.speakerId, speaker.id));
  
  let talkEvents = null;
  if (talks[0]?.talks) {
    talkEvents = await db
      .select()
      .from(eventTalksTable)
      .leftJoin(eventsTable, eq(eventTalksTable.eventId, eventsTable.id))
      .where(eq(eventTalksTable.talkId, talks[0].talks?.id));
  }
  
  return { speaker, talks, talkEvents };
}

// Sponsor functions
export async function createSponsor(
  sponsor: InsertSponsor,
  darkLogoFilePath: string,
  lightLogoFilePath: string
) {
  const container = buildContainer();

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

  // Process dark logo
  const darkLogoUuid = randomUUID();
  const darkLogoFile = Bun.file(darkLogoFilePath);
  const darkLogoBuffer = await darkLogoFile.bytes();
  const darkLogoMetadata = await getImgMetadata(darkLogoBuffer);
  const nameSlug = sponsor.name.toLowerCase().replace(/ /g, "-");
  const darkLogoS3Path =
    "sponsors/" +
    nameSlug +
    "-dark-" +
    darkLogoUuid +
    "." +
    darkLogoMetadata.format;
  const darkLogoPlaceholder = await getImgPlaceholder(darkLogoBuffer);
  await bunS3Client.write(darkLogoS3Path, darkLogoBuffer);
  const darkLogoUrl = `${container.cradle.mainConfig.s3.url}/${darkLogoS3Path}`;
  await container.cradle.db.insert(imagesTable).values({
    url: darkLogoUrl,
    id: darkLogoUuid,
    width: darkLogoMetadata.width,
    height: darkLogoMetadata.height,
    placeholder: darkLogoPlaceholder,
    alt: `${sponsor.name} dark logo`,
  });

  // Process light logo
  const lightLogoUuid = randomUUID();
  const lightLogoFile = Bun.file(lightLogoFilePath);
  const lightLogoBuffer = await lightLogoFile.bytes();
  const lightLogoMetadata = await getImgMetadata(lightLogoBuffer);
  const lightLogoS3Path =
    "sponsors/" +
    nameSlug +
    "-light-" +
    lightLogoUuid +
    "." +
    lightLogoMetadata.format;
  const lightLogoPlaceholder = await getImgPlaceholder(lightLogoBuffer);
  await bunS3Client.write(lightLogoS3Path, lightLogoBuffer);
  const lightLogoUrl = `${container.cradle.mainConfig.s3.url}/${lightLogoS3Path}`;
  await container.cradle.db.insert(imagesTable).values({
    url: lightLogoUrl,
    id: lightLogoUuid,
    width: lightLogoMetadata.width,
    height: lightLogoMetadata.height,
    placeholder: lightLogoPlaceholder,
    alt: `${sponsor.name} light logo`,
  });

  // Update sponsor object with logo UUIDs
  sponsor.squareLogoDark = darkLogoUuid;
  sponsor.squareLogoLight = lightLogoUuid;

  // Insert sponsor into database
  const sponsorRes = await container.cradle.db
    .insert(sponsorsTable)
    .values(sponsor)
    .returning();
  
  return sponsorRes[0];
}

export async function addSponsorToEvent(slug: string, sponsorName: string) {
  const container = buildContainer();

  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }

  const sponsors = await container.cradle.db
    .select()
    .from(sponsorsTable)
    .where(eq(sponsorsTable.name, sponsorName));
  if (sponsors.length !== 1) {
    throw new Error("Sponsor not found");
  }

  await container.cradle.db.insert(eventSponsorsTable).values({
    eventId: event.id,
    sponsorId: sponsors[0].id,
  });
  
  return { event, sponsor: sponsors[0] };
}

// Image functions
export async function getImgIdsForUrls(imageUrls: string[]) {
  const container = buildContainer();
  const db = container.cradle.db;
  const images = await db.select().from(imagesTable);
  const ids: string[] = [];
  
  for (const image of images) {
    if (imageUrls.includes(image.url)) {
      ids.push(image.id);
    }
  }
  return ids;
}

export async function deleteImages(imageUrls: string[]) {
  const container = buildContainer();
  const ids = await getImgIdsForUrls(imageUrls);

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

  const results = [];
  for await (const id of ids) {
    const image = await container.cradle.db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.id, id))
      .then((data) => data[0]);
    if (!image) {
      throw Error(`Image with id ${id} not found`);
    }
    const eventImage = await container.cradle.db
      .select()
      .from(eventImagesTable)
      .where(eq(eventImagesTable.imageId, id))
      .then((data) => data[0]);
    if (!eventImage) {
      throw Error(`Event image with id ${id} not found`);
    }
    const event = await container.cradle.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventImage.eventId))
      .then((data) => data[0]);
    if (!event) {
      throw Error(`Event with id ${eventImage.eventId} not found`);
    }
    const s3Path = image.url.replace(
      container.cradle.mainConfig.s3.url + "/",
      "",
    );
    await bunS3Client.delete(s3Path);
    await container.cradle.db
      .delete(eventImagesTable)
      .where(eq(eventImagesTable.imageId, id));
    await container.cradle.db.delete(imagesTable).where(eq(imagesTable.id, id));
    results.push({ id, eventName: event.name });
  }
  
  return results;
}

export async function addImagesToEvent(eventSlug: string, imagesDir: string = "./scripts/images") {
  const container = buildContainer();
  const event = await container.cradle.queryClient.getEventBySlug(eventSlug);
  if (!event) {
    throw new Error(`Event with slug ${eventSlug} not found`);
  }

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });
  
  const fileNames = await readdir(imagesDir);
  const filePaths = fileNames.map((fn) => join(imagesDir, fn));
  
  const results = [];
  for await (const entry of filePaths) {
    const uuid = randomUUID();
    const file = Bun.file(entry);
    const buffer = await file.bytes();
    const { width, height, format } = await getImgMetadata(buffer);
    const path = "events/" + event.slug + "/" + uuid + "." + format;
    const placeholder = await getImgPlaceholder(buffer);
    await bunS3Client.write(path, buffer);
    const url = `${container.cradle.mainConfig.s3.url}/${path}`;
    const [image] = await container.cradle.db
      .insert(imagesTable)
      .values({
        url,
        id: uuid,
        width,
        height,
        placeholder,
        alt: `Event image for ${event.name}`,
      })
      .returning();
    await container.cradle.db.insert(eventImagesTable).values({
      eventId: event.id,
      imageId: image.id,
    });
    results.push(image);
  }
  
  return results;
} 

// Luma functions
export async function getLumaEvent(eventId: string): Promise<LumaEventPayload> {
  const container = buildContainer();
  const lumaClient = container.cradle.lumaClient;
  const event = await lumaClient.getEvent(eventId);
  if (!event) {
    throw new Error("Failed to fetch event from Luma - API key may not be configured");
  }
  return event;
} 