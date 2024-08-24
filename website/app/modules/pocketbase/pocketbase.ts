export type Event = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  start: Date;
  end: Date;
  fullAddress: string;
  shortLocation: string;
  attendeeLimit: number;
  lumaEventId?: string;
  speakers: string[];
  created: Date;
  updated: Date;
};

export type Speaker = {
  id: string;
  name: string;
  email: string;
  title: string;
  profileImage: string;
};

export type EventWithSpeakers = Omit<Event, "speakers"> & {
  speakers: Speaker[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toEvent(event: any): Event {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    tagline: event.tagline,
    start: new Date(event.start),
    end: new Date(event.end),
    fullAddress: event.fullAddress,
    shortLocation: event.shortLocation,
    attendeeLimit: event.attendeeLimit,
    lumaEventId: event.lumaEventId,
    speakers: event.speakers,
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
    profileImage: speaker.profileImage,
  };
}

export function toEventWithSpeakers(event: any): EventWithSpeakers {
  return {
    ...toEvent(event),
    speakers: event.speakers.map(toSpeaker),
  };
}

export type Attendee = {
  id: string;
  eventId: string;
  name: string;
  email: string;
  canceled: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAttendee(attendee: any): Attendee {
  return {
    id: attendee.id,
    eventId: attendee.event,
    name: attendee.name,
    email: attendee.email,
    canceled: attendee.canceled,
  };
}
