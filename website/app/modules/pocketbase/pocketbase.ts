export type Event = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  start: Date;
  end: Date;
  fullAddress: string;
  streetAddress: string;
  shortLocation: string;
  attendeeLimit: number;
  lumaEventId?: string;
  speakers: string[];
  sponsors: string[];
  created: Date;
  updated: Date;
};

export type Attendee = {
  id: string;
  eventId: string;
  name: string;
  email: string;
  canceled: boolean;
};

export type Speaker = {
  id: string;
  name: string;
  email: string;
  title: string;
  profileImage: string;
};

export type Sponsor = {
  id: string;
  name: string;
  rectangularLogo: string;
  about: string;
};

export type ExpandedEvent = Omit<Event, "speakers"| "sponsors"> & {
  speakers: Speaker[];
  sponsors: Sponsor[];
};

export function deserializeEvent(event: any) {
  return {
    ...event,
    start: new Date(event.start),
    end: new Date(event.end),
    created: new Date(event.created),
    updated: new Date(event.updated),
  };
}

export function isEventInPast(event: Event) {
  return event.end < new Date();
}

export function hasEventStarted(event: Event) {
  return event.start < new Date();
}


