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
  isDraft: boolean;
  isHackathon: boolean;
  highlightOnLandingPage: boolean;
  talkIds: string[];
  sponsorIds: string[];
  previewImageUrl: string;
  previewImageId: string | null;
  photos: string[];
  photosIds: string[];
  recordingUrl: string | null;
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

export type PublicMemberProfile = {
  id: string;
  name: string;
  profileImageUrl: string;
  profileImageId: string;
  title: string | null;
  bio: string | null;
  type: 'member' | 'organizer';
  linkedinUrl: string | null;
  twitterUrl: string | null;
  blueskyUrl: string | null;
};
