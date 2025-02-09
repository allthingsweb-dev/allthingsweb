import { Image } from "./images";
import { Profile } from "./profiles";

export type Sponsor = {
  id: string;
  name: string;
  about: string;
  squareLogoLight: Image;
  squareLogoDark: Image;
};

export type Speaker = Profile & {
  talkId: string;
};

export type Talk = {
  id: string;
  title: string;
  description: string;
};

export type ExpandedTalk = Talk & {
  speakers: Profile[];
};

export type Event = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  slug: string;
  tagline: string;
  attendeeLimit: number;
  streetAddress: string | null;
  shortLocation: string | null;
  fullAddress: string | null;
  lumaEventId: string | null;
  lumaEventUrl: string | null;
  isHackathon: boolean;
  isDraft: boolean;
  highlightOnLandingPage: boolean;
  previewImage: Image;
  recordingUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExpandedEvent = Event & {
  talks: ExpandedTalk[];
  sponsors: Sponsor[];
  images: Image[];
};

export function isEventInPast(event: Event) {
  return event.endDate < new Date();
}

export function hasEventStarted(event: Event) {
  return event.startDate < new Date();
}
