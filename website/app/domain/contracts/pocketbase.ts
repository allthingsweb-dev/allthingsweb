import { Attendee, ExpandedEvent, ExpandedTalk, Link, Speaker, Sponsor, Talk, Event } from './content';

export type PocketBaseClient = {
  authenticateAdmin: () => Promise<void>;
  getEvents: () => Promise<Event[]>;
  getUpcomingEvents: () => Promise<Event[]>;
  getPastEvents: () => Promise<Event[]>;
  getEventBySlug: (slug: string) => Promise<Event | null>;
  getExpandedEventBySlug: (slug: string) => Promise<ExpandedEvent | null>;
  getEventByLumaEventId: (lumaEventId: string) => Promise<Event | null>;
  getSpeakers: () => Promise<Speaker[]>;
  getTalks: () => Promise<Talk[]>;
  registerAttendee: (eventId: string, name: string, email: string) => Promise<Attendee>;
  getAttendeeByEmail: (eventId: string, email: string) => Promise<Attendee | null>;
  getAttendees: (eventId: string) => Promise<Attendee[]>;
  getAttendeeCount: (eventId: string) => Promise<number>;
  updateAttendeeCancellation: (attendeeId: string, canceled: boolean) => Promise<void>;
  getLink: (id: string) => Promise<Link | null>;
  toEvent: (event: any) => Event;
  toSpeaker: (speaker: any) => Speaker;
  toTalk: (talk: any) => Talk;
  toExpandedTalk: (talk: any) => ExpandedTalk;
  toSponsor: (sponsor: any) => Sponsor;
  toExpandedEvent: (event: any) => ExpandedEvent;
  toAttendee: (attendee: any) => Attendee;
  toLink: (link: any) => Link;
  getPocketbaseUrlForImage: (imageId: string, thumb?: { width: number; height: number }) => string;
};
