import PocketBase from "pocketbase";
import { env } from "../env";
import { toEvent, Event, toAttendee } from "./pocketbase";

const pb = new PocketBase(env.pocketbaseOrigin);
pb.autoCancellation(false);

export async function getEvents(): Promise<Event[]> {
  const resultList = await pb.collection("events").getFullList();
  return resultList.map(toEvent);
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  try {
    const event = await pb.collection("events").getFirstListItem(`slug="${slug}"`);
    if (!event) {
      return null;
    }
    return toEvent(event);
  } catch (error) {
    return null;
  }
}

export async function registerAttendee(
  eventId: string,
  name: string,
  email: string
) {
  return pb.collection("attendees").create({
    event: eventId,
    name,
    email,
  });
}

export async function getAttendeeByEmail(eventId: string, email: string) {
  try {
    const attendee = await pb.collection("attendees").getFirstListItem(
      `event="${eventId}" && email="${email}"`
    );
    if (!attendee) {
      return null;
    }
    return toAttendee(attendee);
  } catch (error) {
    return null;
  }
}

export async function getAttendeeCount(eventId: string) {
  const result = await pb.collection("attendees").getFullList({
    filter: `event="${eventId}" && canceled=false`,
  });
  return result.length;
}

export async function updateAttendeeCancellation(
  attendeeId: string,
  canceled: boolean
) {
  return pb.collection("attendees").update(attendeeId, { canceled });
}