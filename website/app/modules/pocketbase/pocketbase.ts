import { Event, ExpandedEvent } from '~/domain/contracts/content';

export function deserializeEvent(event: any): Event {
  return {
    ...event,
    start: new Date(event.start),
    end: new Date(event.end),
    created: new Date(event.created),
    updated: new Date(event.updated),
  };
}

export function deserializeExpandedEvent(event: any): ExpandedEvent {
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
