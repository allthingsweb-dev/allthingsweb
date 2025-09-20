import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../src/lib/db";
import { mainConfig } from "../src/lib/config";
import {
  awardsTable,
  eventImagesTable,
  eventSponsorsTable,
  eventTalksTable,
  eventsTable,
  imagesTable,
  InsertAward,
  InsertEvent,
  InsertProfile,
  InsertSponsor,
  InsertTalk,
  profilesTable,
  sponsorsTable,
  talkSpeakersTable,
  talksTable,
} from "../src/lib/schema";
import { randomUUID } from "node:crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/bun";
import { and, eq } from "drizzle-orm";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

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
  if (typeof date === "string") {
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
function prepareEventForUpdate(
  eventData: UpdateEventInput,
): Partial<InsertEvent> {
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
  const preparedEvent = prepareEventForInsert(event);
  const res = await db.insert(eventsTable).values(preparedEvent).returning();
  return res[0];
}

export async function getEventBySlug(slug: string) {
  const events = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.slug, slug));
  return events[0];
}

export async function updateEvent(slug: string, eventData: UpdateEventInput) {
  const event = await getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }
  const preparedEventData = prepareEventForUpdate(eventData);
  const res = await db
    .update(eventsTable)
    .set(preparedEventData)
    .where(eq(eventsTable.id, event.id))
    .returning();
  return res[0];
}

// Profile functions
export async function findProfileByName(name: string) {
  const profile = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, name));
  return profile[0];
}

export async function createProfile(profile: InsertProfile, imgPath: string) {
  const s3Client = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
  });

  const uuid = randomUUID();
  const file = Bun.file(imgPath);
  const buffer = await file.bytes();
  const { width, height, format } = await getImgMetadata(buffer);
  const nameSlug = profile.name.toLowerCase().replace(/ /g, "-");
  const path = "profiles/" + nameSlug + "-" + uuid + "." + format;
  const placeholder = await getImgPlaceholder(buffer);

  // Upload to S3
  await s3Client.putObject({
    Bucket: mainConfig.s3.bucket,
    Key: path,
    Body: buffer,
  });

  const url = `${mainConfig.s3.url}/${path}`;
  await db.insert(imagesTable).values({
    url,
    id: uuid,
    width,
    height,
    placeholder,
    alt: `${profile.name} smiling into the camera`,
  });

  profile.image = uuid;
  const profileRes = await db.insert(profilesTable).values(profile).returning();

  return profileRes[0];
}

export async function replaceProfileImage(name: string, imgPath: string) {
  const s3Client = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
  });

  const profile = await findProfileByName(name);
  if (!profile) {
    throw new Error("Profile not found");
  }

  const imageToDeleteId = profile.image;
  if (!imageToDeleteId) {
    throw new Error("No image to delete");
  }
  const imageToDelete = await db
    .select()
    .from(imagesTable)
    .where(eq(imagesTable.id, imageToDeleteId))
    .then((data) => data[0]);
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

  await s3Client.putObject({
    Bucket: mainConfig.s3.bucket,
    Key: path,
    Body: buffer,
  });

  const url = `${mainConfig.s3.url}/${path}`;
  await db.insert(imagesTable).values({
    url,
    id: uuid,
    width,
    height,
    placeholder,
    alt: `${profile.name} smiling into the camera`,
  });

  await db
    .update(profilesTable)
    .set({
      image: uuid,
    })
    .where(eq(profilesTable.id, profile.id));

  await db.delete(imagesTable).where(eq(imagesTable.id, imageToDeleteId));

  const s3Path = imageToDelete.url.replace(mainConfig.s3.url + "/", "");
  await s3Client.deleteObject({
    Bucket: mainConfig.s3.bucket,
    Key: s3Path,
  });

  return profile;
}

export async function updateProfile(
  name: string,
  profileData: Partial<InsertProfile>,
) {
  const profile = await findProfileByName(name);
  if (!profile) {
    throw new Error("Profile not found");
  }
  const res = await db
    .update(profilesTable)
    .set(profileData)
    .where(eq(profilesTable.id, profile.id))
    .returning();
  return res[0];
}

export async function updateProfileById(
  id: string,
  profileData: Partial<InsertProfile>,
) {
  const res = await db
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
  const talkRes = await db.insert(talksTable).values(talk).returning();
  if (!talkRes[0]) {
    throw new Error("Failed to create talk");
  }

  const talkSpeakerResults = [];
  for (const speakerId of speakerIds) {
    const talkSpeakerRes = await db
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
  const event = await getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }

  await db.insert(eventTalksTable).values({
    eventId: event.id,
    talkId,
  });

  return event;
}

export async function removeTalkFromEvent(slug: string, talkId: string) {
  const event = await getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }

  const result = await db
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
  const speaker = await findProfileByName(speakerName);
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
  lightLogoFilePath: string,
) {
  const s3Client = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
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

  await s3Client.putObject({
    Bucket: mainConfig.s3.bucket,
    Key: darkLogoS3Path,
    Body: darkLogoBuffer,
  });

  const darkLogoUrl = `${mainConfig.s3.url}/${darkLogoS3Path}`;
  await db.insert(imagesTable).values({
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

  await s3Client.putObject({
    Bucket: mainConfig.s3.bucket,
    Key: lightLogoS3Path,
    Body: lightLogoBuffer,
  });

  const lightLogoUrl = `${mainConfig.s3.url}/${lightLogoS3Path}`;
  await db.insert(imagesTable).values({
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
  const sponsorRes = await db.insert(sponsorsTable).values(sponsor).returning();

  return sponsorRes[0];
}

export async function addSponsorToEvent(slug: string, sponsorName: string) {
  const event = await getEventBySlug(slug);
  if (!event) {
    throw new Error("Event not found");
  }

  const sponsors = await db
    .select()
    .from(sponsorsTable)
    .where(eq(sponsorsTable.name, sponsorName));
  if (sponsors.length !== 1) {
    throw new Error("Sponsor not found");
  }

  await db.insert(eventSponsorsTable).values({
    eventId: event.id,
    sponsorId: sponsors[0].id,
  });

  return { event, sponsor: sponsors[0] };
}

// Image functions
export async function getImgIdsForUrls(imageUrls: string[]) {
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
  const ids = await getImgIdsForUrls(imageUrls);
  const s3Client = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
  });

  const results = [];
  for await (const id of ids) {
    const image = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.id, id))
      .then((data) => data[0]);
    if (!image) {
      throw Error(`Image with id ${id} not found`);
    }
    const eventImage = await db
      .select()
      .from(eventImagesTable)
      .where(eq(eventImagesTable.imageId, id))
      .then((data) => data[0]);
    if (!eventImage) {
      throw Error(`Event image with id ${id} not found`);
    }
    const event = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventImage.eventId))
      .then((data) => data[0]);
    if (!event) {
      throw Error(`Event with id ${eventImage.eventId} not found`);
    }
    const s3Path = image.url.replace(mainConfig.s3.url + "/", "");

    await s3Client.deleteObject({
      Bucket: mainConfig.s3.bucket,
      Key: s3Path,
    });

    await db.delete(eventImagesTable).where(eq(eventImagesTable.imageId, id));
    await db.delete(imagesTable).where(eq(imagesTable.id, id));
    results.push({ id, eventName: event.name });
  }

  return results;
}

export async function addImagesToEvent(
  eventSlug: string,
  imagesDir: string = "./scripts/images",
) {
  const event = await getEventBySlug(eventSlug);
  if (!event) {
    throw new Error(`Event with slug ${eventSlug} not found`);
  }

  const s3Client = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
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

    await s3Client.putObject({
      Bucket: mainConfig.s3.bucket,
      Key: path,
      Body: buffer,
    });

    const url = `${mainConfig.s3.url}/${path}`;
    const [image] = await db
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
    await db.insert(eventImagesTable).values({
      eventId: event.id,
      imageId: image.id,
    });
    results.push(image);
  }

  return results;
}

// Administrator functions
export async function addUserToAdmins(userId: string) {
  // First check if user exists in neon_auth.users_sync table
  const { usersSync } = await import("drizzle-orm/neon");
  const userExists = await db
    .select()
    .from(usersSync)
    .where(eq(usersSync.id, userId))
    .then((users) => users[0]);

  if (!userExists) {
    throw new Error(`User with ID ${userId} not found in users_sync table`);
  }

  // Check if user is already an admin
  const { administratorsTable } = await import("../src/lib/schema");
  const existingAdmin = await db
    .select()
    .from(administratorsTable)
    .where(eq(administratorsTable.userId, userId))
    .then((admins) => admins[0]);

  if (existingAdmin) {
    throw new Error(
      `User ${userExists.name || userId} is already an administrator`,
    );
  }

  // Add user to administrators table
  const result = await db
    .insert(administratorsTable)
    .values({ userId })
    .returning();

  return {
    admin: result[0],
    user: userExists,
  };
}

export async function removeUserFromAdmins(userId: string) {
  const { administratorsTable } = await import("../src/lib/schema");

  const result = await db
    .delete(administratorsTable)
    .where(eq(administratorsTable.userId, userId))
    .returning();

  if (!result[0]) {
    throw new Error(`User ${userId} is not an administrator`);
  }

  return result[0];
}

export async function listAdmins() {
  const { administratorsTable } = await import("../src/lib/schema");
  const { usersSync } = await import("drizzle-orm/neon");

  const admins = await db
    .select({
      id: administratorsTable.id,
      userId: administratorsTable.userId,
      createdAt: administratorsTable.createdAt,
      updatedAt: administratorsTable.updatedAt,
      userName: usersSync.name,
      userEmail: usersSync.email,
    })
    .from(administratorsTable)
    .leftJoin(usersSync, eq(administratorsTable.userId, usersSync.id));

  return admins;
}

// Luma functions - simplified since we don't have the container system
export async function getLumaEvent(eventId: string) {
  // This would need to be implemented with the Luma client from the app
  throw new Error(
    "getLumaEvent not implemented - use the Luma client from the app",
  );
}

// DANGER: Secret profile deletion function - use with extreme caution
export async function deleteProfile(profileId: string) {
  console.log(`🚨 DANGER: Attempting to delete profile ${profileId}`);

  // First, get the profile to ensure it exists
  const profile = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, profileId))
    .then((profiles) => profiles[0]);

  if (!profile) {
    throw new Error(`Profile with ID ${profileId} not found`);
  }

  console.log(`Found profile: ${profile.name} (${profile.profileType})`);

  // Check if profile has any associated talks - SAFETY CHECK
  const talkAssociations = await db
    .select()
    .from(talkSpeakersTable)
    .where(eq(talkSpeakersTable.speakerId, profileId));

  if (talkAssociations.length > 0) {
    throw new Error(
      `❌ DELETION ABORTED: Profile has ${talkAssociations.length} associated talk(s). Cannot delete.`,
    );
  }

  // Even if no associations exist, manually delete any potential orphaned records
  // to avoid cascade delete issues with Neon's replication
  console.log("🧹 Cleaning up any potential talk_speakers references...");

  // Get all talk_speaker records for this profile to delete them precisely
  const speakerRecords = await db
    .select({
      talkId: talkSpeakersTable.talkId,
      speakerId: talkSpeakersTable.speakerId,
    })
    .from(talkSpeakersTable)
    .where(eq(talkSpeakersTable.speakerId, profileId));

  // Delete each record using both primary key columns
  for (const record of speakerRecords) {
    await db
      .delete(talkSpeakersTable)
      .where(
        and(
          eq(talkSpeakersTable.talkId, record.talkId),
          eq(talkSpeakersTable.speakerId, record.speakerId),
        ),
      );
  }

  console.log(
    `✅ Talk speakers cleanup completed (${speakerRecords.length} records processed)`,
  );

  console.log("✅ No talk associations found, proceeding with deletion...");

  const s3Client = new S3Client({
    region: mainConfig.s3.region,
    credentials: {
      accessKeyId: mainConfig.s3.accessKeyId,
      secretAccessKey: mainConfig.s3.secretAccessKey,
    },
  });

  // Get the associated image if it exists
  let image = null;
  if (profile.image) {
    image = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.id, profile.image))
      .then((images) => images[0]);
  }

  try {
    // Step 1: Delete image from S3 if it exists
    if (image) {
      console.log(`Deleting image from S3: ${image.url}`);
      const s3Path = image.url.replace(mainConfig.s3.url + "/", "");

      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: mainConfig.s3.bucket,
          Key: s3Path,
        }),
      );
      console.log("✅ Image deleted from S3");
    }

    // Step 2: Delete image record from database
    if (profile.image) {
      console.log(`Deleting image record: ${profile.image}`);
      await db.delete(imagesTable).where(eq(imagesTable.id, profile.image));
      console.log("✅ Image record deleted from database");
    }

    // Step 3: Delete the profile
    console.log(`Deleting profile: ${profileId}`);
    const deletedProfile = await db
      .delete(profilesTable)
      .where(eq(profilesTable.id, profileId))
      .returning();

    if (deletedProfile.length === 0) {
      throw new Error(
        "Failed to delete profile - profile may have been deleted by another process",
      );
    }

    console.log("✅ Profile deleted successfully");

    return {
      deletedProfile: deletedProfile[0],
      deletedImage: image,
      message: `Successfully deleted profile: ${profile.name} (${profile.profileType})`,
    };
  } catch (error) {
    console.error("❌ Error during deletion process:", error);
    throw new Error(`Deletion failed: ${error.message}`);
  }
}

// Award management functions
export interface CreateAwardInput {
  eventId: string;
  name: string;
}

export async function createAward(input: CreateAwardInput) {
  console.log("🏆 Creating award...");

  try {
    // Check if event exists
    const event = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, input.eventId))
      .limit(1);

    if (event.length === 0) {
      throw new Error(`Event with ID ${input.eventId} not found`);
    }

    // Check if award with same name already exists for this event
    const existingAward = await db
      .select()
      .from(awardsTable)
      .where(
        and(
          eq(awardsTable.eventId, input.eventId),
          eq(awardsTable.name, input.name),
        ),
      )
      .limit(1);

    if (existingAward.length > 0) {
      throw new Error(`Award "${input.name}" already exists for this event`);
    }

    const awardData: InsertAward = {
      id: randomUUID(),
      eventId: input.eventId,
      name: input.name,
    };

    const [newAward] = await db
      .insert(awardsTable)
      .values(awardData)
      .returning();

    console.log(
      `✅ Award created: ${newAward.name} for event ${event[0].name}`,
    );

    return {
      award: newAward,
      event: event[0],
      message: `Successfully created award: ${newAward.name}`,
    };
  } catch (error) {
    console.error("❌ Error creating award:", error);
    throw new Error(`Failed to create award: ${error.message}`);
  }
}

export async function listAwards(eventId: string) {
  console.log("📋 Listing awards for event...");

  try {
    // Check if event exists
    const event = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1);

    if (event.length === 0) {
      throw new Error(`Event with ID ${eventId} not found`);
    }

    const awards = await db
      .select()
      .from(awardsTable)
      .where(eq(awardsTable.eventId, eventId))
      .orderBy(awardsTable.createdAt);

    console.log(`✅ Found ${awards.length} awards for event ${event[0].name}`);

    return {
      awards,
      event: event[0],
      count: awards.length,
      message: `Found ${awards.length} awards for event: ${event[0].name}`,
    };
  } catch (error) {
    console.error("❌ Error listing awards:", error);
    throw new Error(`Failed to list awards: ${error.message}`);
  }
}
