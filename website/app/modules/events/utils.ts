import type { Event } from '../allthingsweb/public-types';

export function isEventInPast(event: Event) {
  return event.end < new Date();
}

export function hasEventStarted(event: Event) {
  return event.start < new Date();
}
