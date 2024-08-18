export type Event = {
    id: string;
    slug: string;
    name: string;
    start: Date;
    tagline: string;
    attendeeLimit?: number;
    created: Date;
    updated: Date;
  };
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function toEvent(event: any): Event {
    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      start: new Date(event.start),
      tagline: event.tagline,
      attendeeLimit: event.attendeeLimit === 0 ? undefined : event.attendeeLimit,
      created: new Date(event.created),
      updated: new Date(event.updated),
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