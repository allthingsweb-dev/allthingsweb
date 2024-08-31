import { LoaderFunctionArgs } from "@remix-run/node";
import { getAttendeeCount, getEventBySlug } from "../pocketbase/api.server";
import { isEventInPast } from "../pocketbase/pocketbase";
import { getAttendeeCount as getLumaAttendeeCount } from "../luma/api.server";

export async function eventDetailsLoader(slug: string) {
  const event = await getEventBySlug(slug);
  if (!event) {
    throw new Response("Not Found", { status: 404 });
  }
  const attendeeCount = event.enableRegistrations
    ? await getAttendeeCount(event.id)
    : await getLumaAttendeeCount(event.lumaEventId);
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

export function loader({ params }: LoaderFunctionArgs) {
  if (!params.slug) {
    throw new Error("No slug provided");
  }
  return eventDetailsLoader(params.slug);
}
