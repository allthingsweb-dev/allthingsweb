import PocketBase, { ClientResponseError } from 'pocketbase';
import { Attendee, Event, ExpandedEvent, ExpandedTalk, Link, Speaker, Sponsor, Talk } from '~/domain/contracts/content';
import { MainConfig } from '~/domain/contracts/config';
import { PocketBaseClient } from '~/domain/contracts/pocketbase';

type Deps = {
  mainConfig: MainConfig;
};

export const createPocketbaseClient = ({ mainConfig }: Deps): PocketBaseClient => {
  const pb = new PocketBase(mainConfig.pocketbase.origin);
  pb.autoCancellation(false);

  const authenticateAdmin = async () => {
    if (!pb.authStore.isValid) {
      await pb.admins.authWithPassword(mainConfig.pocketbase.adminEmail, mainConfig.pocketbase.adminPassword);
    }
  };

  const getEvents = async () => {
    await authenticateAdmin();
    const resultList = await pb.collection('events').getFullList({
      filter: 'isDraft = false',
      sort: 'start',
    });
    return resultList.map(toEvent);
  };

  const getUpcomingEvents = async () => {
    await authenticateAdmin();
    const resultList = await pb.collection('events').getFullList({
      filter: `end >= "${new Date().toISOString()}" && isDraft = false`,
      sort: 'start',
    });
    return resultList.map(toEvent);
  };

  const getPastEvents = async () => {
    await authenticateAdmin();
    const resultList = await pb.collection('events').getFullList({
      filter: `end < "${new Date().toISOString()}"`,
      sort: '-start',
    });
    return resultList.map(toEvent);
  };

  const getEventBySlug = async (slug: string) => {
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
  };

  const getExpandedEventBySlug = async (slug: string) => {
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
  };

  const getEventByLumaEventId = async (lumaEventId: string) => {
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
  };

  const getSpeakers = async () => {
    await authenticateAdmin();
    const speakers = await pb.collection('speakers').getFullList();
    return speakers.map(toSpeaker);
  };

  const getTalks = async () => {
    await authenticateAdmin();
    const talks = await pb.collection('talks').getFullList();
    return talks.map(toTalk);
  };

  const registerAttendee = async (eventId: string, name: string, email: string) => {
    await authenticateAdmin();
    return (await pb.collection('attendees').create({
      event: eventId,
      name,
      email,
    })) as Attendee;
  };

  const getAttendeeByEmail = async (eventId: string, email: string) => {
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
  };

  const getAttendees = async (eventId: string) => {
    await authenticateAdmin();
    const result = await pb.collection('attendees').getFullList({
      filter: `event="${eventId}" && canceled=false`,
    });
    return result.map(toAttendee);
  };

  const getAttendeeCount = async (eventId: string) => {
    const attendees = await getAttendees(eventId);
    return attendees.length;
  };

  const updateAttendeeCancellation = async (attendeeId: string, canceled: boolean) => {
    await authenticateAdmin();
    await pb.collection('attendees').update(attendeeId, { canceled });
  };

  const getLink = async (id: string): Promise<Link | null> => {
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
  };

  const toEvent = (event: any): Event => {
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
      lumaEventId: event.lumaEventId || undefined,
      lumaUrl: event.lumaEventId ? `https://lu.ma/event/${event.lumaEventId}` : undefined,
      enableRegistrations: event.enableRegistrations,
      isDraft: event.isDraft || false,
      highlightOnLandingPage: event.highlightOnLandingPage,
      isHackathon: event.isHackathon,
      talkIds: event.talks,
      sponsorIds: event.sponsors,
      previewImageUrl: event.previewImage
        ? `${mainConfig.origin}/img/pocketbase/events/${event.id}/${event.previewImage}?w=1200&h=1200`
        : `${mainConfig.origin}/img/gen/${event.slug}/preview.png?w=1200&h=1200`,
      previewImageId: event.previewImage ? `/events/${event.id}/${event.previewImage}` : null,
      photos: event.photos.map((photo: string) => `/img/pocketbase/events/${event.id}/${photo}`),
      photosIds: event.photos.map((photo: string) => `/events/${event.id}/${photo}`),
      created: new Date(event.created),
      updated: new Date(event.updated),
    };
  };

  const toSpeaker = (speaker: any): Speaker => {
    return {
      id: speaker.id,
      name: speaker.name,
      email: speaker.email,
      title: speaker.title,
      profileImageUrl: `/img/pocketbase/speakers/${speaker.id}/${speaker.profileImage}`,
      profileImageId: `/speakers/${speaker.id}/${speaker.profileImage}`,
      linkedinUrl: speaker.linkedinHandle ? `https://www.linkedin.com/in/${speaker.linkedinHandle}` : null,
      twitterUrl: speaker.twitterHandle ? `https://twitter.com/${speaker.twitterHandle}` : null,
      blueskyUrl: speaker.blueskyHandle ? `https://bsky.app/profile/${speaker.blueskyHandle}` : null,
      bio: speaker.bio,
    };
  };

  const toTalk = (talk: any): Talk => {
    return {
      id: talk.id,
      title: talk.title,
      description: talk.description,
      speakerId: talk.speaker,
    };
  };

  const toExpandedTalk = (talk: any): ExpandedTalk => {
    return {
      id: talk.id,
      title: talk.title,
      description: talk.description,
      speakerId: talk.speaker,
      speaker: toSpeaker(talk.expand.speaker),
    };
  };

  const toSponsor = (sponsor: any): Sponsor => {
    return {
      id: sponsor.id,
      name: sponsor.name,
      squareLogo: `/img/pocketbase/sponsors/${sponsor.id}/${sponsor.squareLogo}`,
      squareLogoId: `/sponsors/${sponsor.id}/${sponsor.squareLogo}`,
      about: sponsor.about,
    };
  };

  const toExpandedEvent = (event: any): ExpandedEvent => {
    return {
      ...toEvent(event),
      talks: event.expand?.talks?.map(toExpandedTalk) || [],
      sponsors: event.expand?.sponsors?.map(toSponsor) || [],
    };
  };

  const toAttendee = (attendee: any): Attendee => {
    return {
      id: attendee.id,
      eventId: attendee.event,
      name: attendee.name,
      email: attendee.email,
      canceled: attendee.canceled,
    };
  };

  const toLink = (link: any): Link => {
    return {
      id: link.id,
      destinationUrl: link.destinationUrl,
    };
  };

  // URL for within Fly network
  const getPocketbaseUrlForImage = (imageId: string, thumb?: { width: number; height: number }) => {
    const searchParams = new URLSearchParams();
    if (thumb) {
      searchParams.set('thumb', `${thumb.width}x${thumb.height}`);
    }
    return `${mainConfig.pocketbase.origin}/api/files${imageId}?${searchParams.toString()}`;
  };

  return {
    authenticateAdmin,
    getEvents,
    getUpcomingEvents,
    getPastEvents,
    getEventBySlug,
    getExpandedEventBySlug,
    getEventByLumaEventId,
    getSpeakers,
    getTalks,
    registerAttendee,
    getAttendeeByEmail,
    getAttendees,
    getAttendeeCount,
    updateAttendeeCancellation,
    getLink,
    toEvent,
    toSpeaker,
    toTalk,
    toExpandedTalk,
    toSponsor,
    toExpandedEvent,
    toAttendee,
    toLink,
    getPocketbaseUrlForImage,
  };
};
