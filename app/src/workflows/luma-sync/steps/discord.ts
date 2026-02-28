import { postEventReviewCard } from "@/lib/discord/review-bot";
import type { LumaSyncCreatedEvent } from "../types";

export type DiscordReviewThread = {
  channelId: string;
  rootMessageId: string;
  threadId: string;
  lastSeenMessageId: string | null;
};

export async function createDiscordReviewThreadForEvent(
  event: LumaSyncCreatedEvent,
): Promise<DiscordReviewThread> {
  "use step";
  const message = await postEventReviewCard({
    eventId: event.id,
    name: event.name,
    slug: event.slug,
    startDate: event.startDate,
    endDate: event.endDate,
    tagline: event.tagline,
    attendeeLimit: event.attendeeLimit,
    lumaEventId: event.lumaEventId,
    isDraft: event.isDraft,
  });

  return {
    channelId: message.channelId,
    rootMessageId: message.rootMessageId,
    threadId: message.rootMessageId,
    lastSeenMessageId: null,
  };
}
