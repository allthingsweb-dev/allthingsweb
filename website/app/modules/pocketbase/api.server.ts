import PocketBase from "pocketbase";
import { env } from "../env.server";
import { Attendee, Event, ExpandedEvent, Speaker, Sponsor } from "./pocketbase";

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
  await authenticateAdmin();
  const resultList = await pb.collection("events").getFullList();
  return resultList.map(toEvent);
}

export async function getUpcomingEvents(): Promise<Event[]> {
  await authenticateAdmin();
  const resultList = await pb.collection("events").getFullList({
    filter: `start >= "${new Date().toISOString()}"`,
    sort: "start",
  });
  return resultList.map(toEvent);
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  await authenticateAdmin();
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

export async function getExpandedEvent(slug: string): Promise<ExpandedEvent | null> {
  await authenticateAdmin();
  try {
    const event = await pb
      .collection("events")
      .getFirstListItem(`slug="${slug}"`, {
        expand: "speakers,sponsors",
      });
    if (!event) {
      return null;
    }
    return toExpandedEvent(event);
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function getEventByLumaEventId(lumaEventId: string): Promise<Event | null> {
  await authenticateAdmin();
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

export async function getAttendees(eventId: string) {
  await authenticateAdmin();
  const result = await pb.collection("attendees").getFullList({
    filter: `event="${eventId}" && canceled=false`,
  });
  return result.map(toAttendee);
}

export async function getAttendeeCount(eventId: string) {
  const attendees = await getAttendees(eventId);
  return attendees.length;
}

export async function updateAttendeeCancellation(
  attendeeId: string,
  canceled: boolean
) {
  await authenticateAdmin();
  return pb.collection("attendees").update(attendeeId, { canceled });
}

export function toEvent(event: any): Event {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    tagline: event.tagline,
    start: new Date(event.start),
    end: new Date(event.end),
    fullAddress: event.fullAddress,
    streetAddress: event.streetAddress,
    shortLocation: event.shortLocation,
    attendeeLimit: event.attendeeLimit,
    lumaEventId: event.lumaEventId,
    lumaUrl: `https://lu.ma/event/${event.lumaEventId}`,
    enableRegistrations: event.enableRegistrations,
    highlightOnLandingPage: event.highlightOnLandingPage,
    isHackathon: event.isHackathon,
    speakers: event.speakers,
    sponsors: event.sponsors,
    created: new Date(event.created),
    updated: new Date(event.updated),
  };
}

export function toSpeaker(speaker: any): Speaker {
  return {
    id: speaker.id,
    name: speaker.name,
    email: speaker.email,
    title: speaker.title,
    profileImage: `${env.pocketbase.origin}/api/files/speakers/${speaker.id}/${speaker.profileImage}`,
  };
}

export function toSponsor(sponsor: any): Sponsor {
  return {
    id: sponsor.id,
    name: sponsor.name,
    rectangularLogo: `${env.pocketbase.origin}/api/files/sponsors/${sponsor.id}/${sponsor.rectangularLogo}`,
    about: sponsor.about,
  };
}

export function toExpandedEvent(event: any): ExpandedEvent {
  return {
    ...toEvent(event),
    speakers: event.expand?.speakers?.map(toSpeaker) || [],
    sponsors: event.expand?.sponsors?.map(toSponsor) || [],
  };
}

export function toAttendee(attendee: any): Attendee {
  return {
    id: attendee.id,
    eventId: attendee.event,
    name: attendee.name,
    email: attendee.email,
    canceled: attendee.canceled,
  };
}