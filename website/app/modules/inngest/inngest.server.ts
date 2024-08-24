import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "allthingsweb-app",
});

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

export type InngestEventName = keyof InngestEventData;
