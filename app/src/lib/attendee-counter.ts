import { createLumaClient } from "@/lib/luma";

export async function getEventAttendeeCount(
  lumaEventId: string,
): Promise<number> {
  const lumaClient = createLumaClient();

  try {
    return await lumaClient.getAttendeeCount(lumaEventId);
  } catch (error) {
    console.error(
      `Failed to get attendee count for event ${lumaEventId}:`,
      error,
    );
    return 0;
  }
}

export async function getEventAttendees(lumaEventId: string) {
  const lumaClient = createLumaClient();

  try {
    return await lumaClient.getAllAttendees(lumaEventId, {
      approvalStatus: "approved",
    });
  } catch (error) {
    console.error(`Failed to get attendees for event ${lumaEventId}:`, error);
    return [];
  }
}

export async function getEventAttendeesWithManualPagination(
  lumaEventId: string,
) {
  const lumaClient = createLumaClient();
  const allAttendees = [];
  let hasMore = true;
  let cursor: string | undefined;

  try {
    while (hasMore) {
      const result = await lumaClient.getAttendees(lumaEventId, {
        cursor,
        approvalStatus: "approved",
      });

      if (Array.isArray(result) && result.length === 2) {
        const [attendees, paginationInfo] = result;
        if (
          Array.isArray(attendees) &&
          paginationInfo &&
          typeof paginationInfo === "object" &&
          "hasMoreToFetch" in paginationInfo
        ) {
          allAttendees.push(...attendees);
          hasMore = paginationInfo.hasMoreToFetch || false;
          cursor = paginationInfo.nextCursor;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }

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
