import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventsTable, imagesTable } from "@/lib/schema";
import { Event } from "@/lib/events";
import { signImage } from "@/lib/image-signing";
import { getLumaUrl } from "@/lib/luma";

/**
 * Get all published events from the database
 */
export async function getPublishedEvents(): Promise<Event[]> {
  // Get all published events
  const eventsQuery = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.isDraft, false))
    .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
    .orderBy(desc(eventsTable.startDate));

  // Transform to Event type
  const transformToEvent = async (row: any): Promise<Event> => {
    const event = row.events;
    const previewImageRaw = row.images || {
      url: "/hero-image-rocket.png",
      alt: `${event.name} preview`,
      placeholder: null,
      width: 1200,
      height: 630,
    };

    const previewImage = await signImage(previewImageRaw);

    return {
      ...event,
      previewImage,
      lumaEventUrl: getLumaUrl(event.lumaEventId),
    };
  };

  const events = await Promise.all(eventsQuery.map(transformToEvent));
  return events;
}
