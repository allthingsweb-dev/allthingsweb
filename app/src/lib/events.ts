export type Image = {
  url: string;
  alt: string;
  placeholder?: string | null;
  width?: number | null;
  height?: number | null;
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

export function isEventInPast(event: Event) {
  return event.endDate < new Date();
}

export function hasEventStarted(event: Event) {
  return event.startDate < new Date();
}
