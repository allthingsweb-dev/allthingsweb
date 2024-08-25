import { getAttendeeCount, getEventBySlug } from "../pocketbase/api.server";
import { isEventInPast } from "../pocketbase/pocketbase";

  
  export async function loader() {
    const hardcodedSlug = "2024-10-05-hackathon-at-sentry";
    const event = await getEventBySlug(hardcodedSlug);
    if (!event) {
      throw new Response("Not Found", { status: 404 });
    }
    const attendeeCount = await getAttendeeCount(event.id);
    const isAtCapacity = attendeeCount >= event.attendeeLimit;
    const isInPast = isEventInPast(event);
    const isRegistrationDisabled = isAtCapacity || isInPast;
    return {
      event,
      attendeeCount,
      attendeeLimit: event.attendeeLimit,
      isAtCapacity,
      isInPast,
      isRegistrationDisabled,
    };
  }