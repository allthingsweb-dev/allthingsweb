import PocketBase from "pocketbase";
import { env } from "../env.server";
import { toEvent, Event, toAttendee, toEventWithSpeakers, EventWithSpeakers } from "./pocketbase";

const pb = new PocketBase(env.pocketbase.origin);
pb.autoCancellation(false);

export async function authenticateAdmin() {
  if(!pb.authStore.isValid) {
    await pb.admins.authWithPassword(
      env.pocketbase.adminEmail,
      env.pocketbase.adminPassword
    );
  }
}

export async function getEvents(): Promise<Event[]> {
  const resultList = await pb.collection("events").getFullList();
  return resultList.map(toEvent);
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  try {
    const event = await pb
      .collection("events")
      .getFirstListItem(`slug="${slug}"`);
    if (!event) {
      return null;
    }
    return toEvent(event);
  } catch (error) {
    return null;
  }
}

export async function getEventWithSpeakersBySlug(slug: string): Promise<EventWithSpeakers | null> {
  try {
    const event = await pb
      .collection("events")
      .getFirstListItem(`slug="${slug}"`, {
        expand: "speakers.name",
      });
    if (!event) {
      return null;
    }
    console.log(event);
    return toEventWithSpeakers(event);
  } catch (error) {
    return null;
  }
}

export async function getEventByLumaEventId(lumaEventId: string): Promise<Event | null> {
  try {
    const event = await pb
      .collection("events")
      .getFirstListItem(`lumaEventId="${lumaEventId}"`);
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
  await authenticateAdmin();
  return pb.collection("attendees").create({
    event: eventId,
    name,
    email,
  });
}

export async function getAttendeeByEmail(eventId: string, email: string) {
  await authenticateAdmin();
  try {
    const attendee = await pb
      .collection("attendees")
      .getFirstListItem(`event="${eventId}" && email="${email}"`);
    if (!attendee) {
      return null;
    }
    return toAttendee(attendee);
  } catch (error) {
    return null;
  }
}

export async function getAttendeeCount(eventId: string) {
  await authenticateAdmin();
  const result = await pb.collection("attendees").getFullList({
    filter: `event="${eventId}" && canceled=false`,
  });
  return result.length;
}

export async function updateAttendeeCancellation(
  attendeeId: string,
  canceled: boolean
) {
  await authenticateAdmin();
  return pb.collection("attendees").update(attendeeId, { canceled });
}
