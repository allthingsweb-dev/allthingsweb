import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventsTable, imagesTable } from "@/lib/schema";
import { Event } from "@/lib/events";
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
  const transformToEvent = (row: any): Event => {
    const event = row.events;
    const previewImage = row.images || {
      url: "/hero-image-rocket.png",
      alt: `${event.name} preview`,
      placeholder: null,
      width: 1200,
      height: 630,
    };

    return {
      ...event,
      previewImage,
      lumaEventUrl: getLumaUrl(event.lumaEventId),
    };
  };

  return eventsQuery.map(transformToEvent);
}
