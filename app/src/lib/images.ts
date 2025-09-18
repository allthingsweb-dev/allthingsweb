import { inArray, eq, and, lt, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { imagesTable, eventsTable, eventImagesTable } from "@/lib/schema";
import { Image } from "@/lib/events";
import { signImages, signImage } from "@/lib/image-signing";

// Static list of past event image IDs from the original website
const imageIds = [
  "f621e708-a55a-4b42-9d6b-69f14c4b31ce",
  "4b4efb54-3f6e-4f2b-9385-d1a6eda52b42",
  "9561b56c-8d0d-49bc-8ae4-c4732aba7180",
  "0ad3906b-ed44-4b06-adaa-59f249e7f134",
  "976a8737-ece8-41d0-a90c-89f6336f283f",
  "74e1169f-484a-4563-96c7-6a23257ca14d",
  "1399f2e8-5726-4430-820c-de60337e4e62",
  "11a0af02-7d1f-4563-9b8e-d77baf917308",
  "fefa5ff6-4dee-41ec-aa3c-7972aa84dbdb",
  "a4750122-a7b0-4d6d-b7cd-083d1a6e303e",
  "a44a661a-9252-423c-95b3-20393c77580c",
  "673345e6-5bfb-4122-9ab9-8e3f5f24ac93",
  "080f48d1-7eb4-43c9-9440-79f3131b0e49",
  "07fc788e-b13d-498b-8914-9d195be4d6ae",
  "2b220343-569a-441f-acfc-a906b5fb97d0",
  "4d224238-6b78-4d5e-9d84-4ca2d03b91b7",
  "8016e3dc-9b18-4dd1-aab4-d145d2bee6e7",
  "519b7fed-0d6d-42e8-9653-630578b6ef0b",
  "9703c964-7809-4282-b4f2-c5c5be124e87",
  "73a16b87-2d54-4de3-ae5d-d83819ef4a31",
];

export async function getPastEventImages(): Promise<Image[]> {
  const images = await db
    .select()
    .from(imagesTable)
    .where(inArray(imagesTable.id, imageIds));

  // Create a map for faster lookup
  const imageMap = new Map(images.map((img) => [img.id, img]));

  // Get images in the specified order, filtering out missing ones
  const foundImages = imageIds
    .map((id) => imageMap.get(id))
    .filter((image): image is NonNullable<typeof image> => image !== undefined);

  // Convert to Image format and sign all URLs
  const rawImages: Image[] = foundImages.map((image) => ({
    url: image.url,
    alt: image.alt,
    placeholder: image.placeholder,
    width: image.width,
    height: image.height,
  }));

  return signImages(rawImages);
}

export interface EventImageWithDetails {
  imageId: string;
  imageUrl: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  imagePlaceholder: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
  eventStartDate: Date;
}

export async function getAllEventImagesWithDetails(): Promise<
  EventImageWithDetails[]
> {
  const results = await db
    .select({
      imageId: imagesTable.id,
      imageUrl: imagesTable.url,
      imageAlt: imagesTable.alt,
      imageWidth: imagesTable.width,
      imageHeight: imagesTable.height,
      imagePlaceholder: imagesTable.placeholder,
      eventId: eventsTable.id,
      eventName: eventsTable.name,
      eventSlug: eventsTable.slug,
      eventStartDate: eventsTable.startDate,
    })
    .from(eventImagesTable)
    .innerJoin(imagesTable, eq(eventImagesTable.imageId, imagesTable.id))
    .innerJoin(eventsTable, eq(eventImagesTable.eventId, eventsTable.id))
    .orderBy(eventsTable.startDate, eventsTable.name);

  // Sign all image URLs
  const signedResults = await Promise.all(
    results.map(async (result) => {
      const signedImage = await signImage({
        url: result.imageUrl,
        alt: result.imageAlt,
        placeholder: result.imagePlaceholder,
        width: result.imageWidth,
        height: result.imageHeight,
      });

      return {
        ...result,
        imageUrl: signedImage.url,
      };
    }),
  );

  return signedResults;
}

export interface EventWithImages {
  event: {
    id: string;
    name: string;
    slug: string;
    tagline: string;
    startDate: Date;
    endDate: Date;
    shortLocation: string | null;
    fullAddress: string | null;
    attendeeLimit: number;
    streetAddress: string | null;
    isHackathon: boolean;
    isDraft: boolean;
    highlightOnLandingPage: boolean;
    lumaEventId: string | null;
    recordingUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  previewImage?: Image;
  additionalImages: Image[];
}

export async function getPastEventsWithImages(): Promise<EventWithImages[]> {
  const now = new Date();

  // Get all past events
  const pastEvents = await db
    .select()
    .from(eventsTable)
    .where(and(lt(eventsTable.endDate, now), eq(eventsTable.isDraft, false)))
    .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
    .orderBy(desc(eventsTable.startDate));

  // Get additional images for each event
  const eventIds = pastEvents.map((row) => row.events.id);
  const eventImagesQuery = await db
    .select({
      eventId: eventImagesTable.eventId,
      imageId: imagesTable.id,
      imageUrl: imagesTable.url,
      imageAlt: imagesTable.alt,
      imagePlaceholder: imagesTable.placeholder,
      imageWidth: imagesTable.width,
      imageHeight: imagesTable.height,
    })
    .from(eventImagesTable)
    .innerJoin(imagesTable, eq(eventImagesTable.imageId, imagesTable.id))
    .where(inArray(eventImagesTable.eventId, eventIds))
    .orderBy(imagesTable.createdAt);

  // Group additional images by event ID
  const imagesByEventId = eventImagesQuery.reduce(
    (acc, img) => {
      if (!acc[img.eventId]) {
        acc[img.eventId] = [];
      }
      acc[img.eventId].push({
        id: img.imageId,
        url: img.imageUrl,
        alt: img.imageAlt,
        placeholder: img.imagePlaceholder,
        width: img.imageWidth,
        height: img.imageHeight,
      });
      return acc;
    },
    {} as Record<
      string,
      Array<{
        id: string;
        url: string;
        alt: string;
        placeholder: string;
        width: number;
        height: number;
      }>
    >,
  );

  // Process all events and sign images
  const eventsWithImages = await Promise.all(
    pastEvents.map(async (row) => {
      const event = row.events;
      const previewImageRaw = row.images;

      // Sign preview image if exists
      const previewImage = previewImageRaw
        ? await signImage({
            url: previewImageRaw.url,
            alt: previewImageRaw.alt,
            placeholder: previewImageRaw.placeholder,
            width: previewImageRaw.width,
            height: previewImageRaw.height,
          })
        : undefined;

      // Select first and last event images, excluding the preview image if present
      const allEventImages = imagesByEventId[event.id] || [];
      const previewImageId = (event as any).previewImage as string | null;
      const nonPreviewImages = previewImageId
        ? allEventImages.filter((img) => img.id !== previewImageId)
        : allEventImages;

      let selectedImages = nonPreviewImages;
      if (nonPreviewImages.length >= 2) {
        selectedImages = [
          nonPreviewImages[0],
          nonPreviewImages[nonPreviewImages.length - 1],
        ];
      }

      const additionalImages = await Promise.all(
        selectedImages.map((img) =>
          signImage({
            url: img.url,
            alt: img.alt,
            placeholder: img.placeholder,
            width: img.width,
            height: img.height,
          }),
        ),
      );

      return {
        event,
        previewImage,
        additionalImages,
      };
    }),
  );

  return eventsWithImages;
}
