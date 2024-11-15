import { Inngest } from 'inngest';

export type InngestEventData = {
  'event/attendee.registered': {
    attendee: {
      email: string;
      name: string;
      id: string;
    };
    eventSlug: string;
  };
};

type InngestEventName = keyof InngestEventData;

export type InngestServer = {
  inngest: Inngest;
  publishEvent: <T extends InngestEventName>(eventName: T, data: InngestEventData[T]) => void;
};
