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
  lumaUrl?: string;
  enableRegistrations: boolean; // enable registrations via allthingsweb.dev (currently not used)
  isDraft: boolean;
  isHackathon: boolean;
  highlightOnLandingPage: boolean;
  talkIds: string[];
  sponsorIds: string[];
  previewImageUrl: string;
  previewImageId: string | null;
  photos: string[];
  photosIds: string[];
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
  profileImageUrl: string;
  profileImageId: string;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  blueskyUrl: string | null;
  bio: string;
};

export type Sponsor = {
  id: string;
  name: string;
  squareLogo: string;
  squareLogoId: string;
  about: string;
};

export type Talk = {
  id: string;
  title: string;
  description: string;
  speakerId: string;
};

export type ExpandedTalk = Talk & {
  speaker: Speaker;
};

export type ExpandedEvent = Event & {
  talks: ExpandedTalk[];
  sponsors: Sponsor[];
};

export type Link = {
  id: string;
  destinationUrl: string;
};

export type TalkWithEventSlug = Talk & {
  eventName: string;
  eventSlug: string;
  eventStart: Date;
};

export type SpeakerWithTalks = Speaker & {
  talks: TalkWithEventSlug[];
};
