import { Talk } from "./events";
import { Profile } from "./profiles";

export type TalkWithEventCtx = Talk & {
  eventName: string;
  eventSlug: string;
  eventStart: Date;
};

export type SpeakerWithTalkIds = Profile & {
  talkIds: string[];
};
