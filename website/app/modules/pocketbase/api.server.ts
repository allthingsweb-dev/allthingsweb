import PocketBase, { ClientResponseError } from 'pocketbase';
import { env } from '../env.server';
import { Attendee, Event, ExpandedEvent, ExpandedTalk, Link, Speaker, Sponsor, Talk } from './pocketbase';

const pb = new PocketBase(env.pocketbase.origin);
pb.autoCancellation(false);

export async function authenticateAdmin() {
  if (!pb.authStore.isValid) {
    await pb.admins.authWithPassword(env.pocketbase.adminEmail, env.pocketbase.adminPassword);
  }
}

export async function getEvents(): Promise<Event[]> {
  await authenticateAdmin();
  const resultList = await pb.collection('events').getFullList();
  return resultList.map(toEvent);
}

export async function getUpcomingEvents(): Promise<Event[]> {
  await authenticateAdmin();
  const resultList = await pb.collection('events').getFullList({
    filter: `start >= "${new Date().toISOString()}"`,
    sort: 'start',
  });
  return resultList.map(toEvent);
}

export async function getPastEvents(): Promise<Event[]> {
  await authenticateAdmin();

  const resultList = await pb.collection('events').getFullList({
    filter: `start < "${new Date().toISOString()}"`,
    sort: '-start',
  });
  return resultList.map(toEvent);
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  await authenticateAdmin();
  try {
    const event = await pb.collection('events').getFirstListItem(`slug="${slug}"`);
    return toEvent(event);
  } catch (error) {
    if (error instanceof ClientResponseError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getExpandedEventBySlug(slug: string): Promise<ExpandedEvent | null> {
  await authenticateAdmin();
  try {
    const event = await pb.collection('events').getFirstListItem(`slug="${slug}"`, {
      expand: 'talks,talks.speaker,sponsors',
    });
    return toExpandedEvent(event);
  } catch (error) {
    if (error instanceof ClientResponseError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getEventByLumaEventId(lumaEventId: string): Promise<Event | null> {
  await authenticateAdmin();
  try {
    const event = await pb.collection('events').getFirstListItem(`lumaEventId="${lumaEventId}"`);
    return toEvent(event);
  } catch (error) {
    if (error instanceof ClientResponseError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getSpeakers(): Promise<Speaker[]> {
  await authenticateAdmin();
  const speakers = await pb.collection('speakers').getFullList();
  return speakers.map(toSpeaker);
}

export async function getTalks(): Promise<Talk[]> {
  await authenticateAdmin();
  const talks = await pb.collection('talks').getFullList();
  return talks.map(toTalk);
}

export async function registerAttendee(eventId: string, name: string, email: string) {
  await authenticateAdmin();
  return pb.collection('attendees').create({
    event: eventId,
    name,
    email,
  });
}

export async function getAttendeeByEmail(eventId: string, email: string) {
  await authenticateAdmin();
  try {
    const attendee = await pb.collection('attendees').getFirstListItem(`event="${eventId}" && email="${email}"`);
    return toAttendee(attendee);
  } catch (error) {
    if (error instanceof ClientResponseError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getAttendees(eventId: string) {
  await authenticateAdmin();
  const result = await pb.collection('attendees').getFullList({
    filter: `event="${eventId}" && canceled=false`,
  });
  return result.map(toAttendee);
}

export async function getAttendeeCount(eventId: string) {
  const attendees = await getAttendees(eventId);
  return attendees.length;
}

export async function updateAttendeeCancellation(attendeeId: string, canceled: boolean) {
  await authenticateAdmin();
  return pb.collection('attendees').update(attendeeId, { canceled });
}

export async function getLink(id: string): Promise<Link | null> {
  try {
    const linkData = await pb.collection('links').getOne(id);
    if (!linkData) {
      return null;
    }
    return toLink(linkData);
  } catch (error) {
    if (error instanceof ClientResponseError && error.status === 404) {
      return null;
    }
    throw error;
  }
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
    talkIds: event.talks,
    sponsorIds: event.sponsors,
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
    profileImage: `${env.pocketbase.publicOrigin}/api/files/speakers/${speaker.id}/${speaker.profileImage}`,
    linkedinUrl: `https://www.linkedin.com/in/${speaker.linkedinHandle}`,
    twitterUrl: `https://twitter.com/${speaker.twitterHandle}`,
    bio: speaker.bio,
  };
}

export function toTalk(talk: any): Talk {
  return {
    id: talk.id,
    title: talk.title,
    description: talk.description,
    speakerId: talk.speaker,
  };
}

export function toExpandedTalk(talk: any): ExpandedTalk {
  return {
    id: talk.id,
    title: talk.title,
    description: talk.description,
    speakerId: talk.speaker,
    speaker: toSpeaker(talk.expand.speaker),
  };
}

export function toSponsor(sponsor: any): Sponsor {
  return {
    id: sponsor.id,
    name: sponsor.name,
    rectangularLogo: `${env.pocketbase.publicOrigin}/api/files/sponsors/${sponsor.id}/${sponsor.rectangularLogo}`,
    about: sponsor.about,
  };
}

export function toExpandedEvent(event: any): ExpandedEvent {
  return {
    ...toEvent(event),
    talks: event.expand?.talks?.map(toExpandedTalk) || [],
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

export function toLink(link: any): Link {
  return {
    id: link.id,
    destinationUrl: link.destinationUrl,
  };
}
