import { createLumaClient } from "@/lib/luma";

/**
 * Get the total count of approved attendees for a Luma event
 * This function properly handles pagination to get the accurate count
 */
export async function getEventAttendeeCount(
  lumaEventId: string,
): Promise<number> {
  const lumaClient = createLumaClient();

  try {
    // This function automatically handles pagination and returns the total count
    return await lumaClient.getAttendeeCount(lumaEventId);
  } catch (error) {
    console.error(
      `Failed to get attendee count for event ${lumaEventId}:`,
      error,
    );
    return 0;
  }
}

/**
 * Get all approved attendees for a Luma event
 * This function properly handles pagination to get all attendees
 */
export async function getEventAttendees(lumaEventId: string) {
  const lumaClient = createLumaClient();

  try {
    // This function automatically handles pagination and returns all attendees
    return await lumaClient.getAllAttendees(lumaEventId, {
      approvalStatus: "approved",
    });
  } catch (error) {
    console.error(`Failed to get attendees for event ${lumaEventId}:`, error);
    return [];
  }
}

/**
 * Example of manual pagination if you need more control
 */
export async function getEventAttendeesWithManualPagination(
  lumaEventId: string,
) {
  const lumaClient = createLumaClient();
  const allAttendees = [];
  let hasMore = true;
  let cursor: string | undefined;

  try {
    while (hasMore) {
      const [attendees, { hasMoreToFetch, nextCursor }] =
        await lumaClient.getAttendees(lumaEventId, {
          cursor,
          approvalStatus: "approved",
        });

      allAttendees.push(...attendees);
      hasMore = hasMoreToFetch;
      cursor = nextCursor;

      // Optional: Add a small delay to avoid rate limiting
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return allAttendees;
  } catch (error) {
    console.error(
      `Failed to get attendees with manual pagination for event ${lumaEventId}:`,
      error,
    );
    return [];
  }
}
