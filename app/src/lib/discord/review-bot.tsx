import { createDiscordAdapter } from "@chat-adapter/discord";
import { createRedisState } from "@chat-adapter/state-redis";
import {
  Actions,
  Button,
  Card,
  CardText,
  Chat,
  Field,
  Fields,
  type Message,
  type Thread,
} from "chat";
import { mainConfig } from "@/lib/config";
import { runDiscordPromptAgent } from "@/lib/discord/prompt-agent";
import { approveDiscordReviewSessionByEventId } from "@/lib/review/approval";

type ReviewCardInput = {
  eventId: string;
  name: string;
  slug: string;
  startDate: Date;
  endDate: Date;
  tagline: string;
  attendeeLimit: number;
  lumaEventId: string | null;
  isDraft: boolean;
};

type RecentMessageContext = {
  author: string;
  text: string;
  isBot: boolean;
};

let reviewBot: Chat<{
  discord: ReturnType<typeof createDiscordAdapter>;
}> | null = null;
let handlersRegistered = false;

function requireDiscordConfig() {
  const botToken = mainConfig.discord.botToken?.trim();
  const publicKey = mainConfig.discord.publicKey?.trim();
  const applicationId = mainConfig.discord.applicationId?.trim();
  const guildId = mainConfig.discord.guildId?.trim();
  const reviewChannelId = mainConfig.discord.reviewChannelId?.trim();
  const redisUrl = mainConfig.chat.redisUrl?.trim();

  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not set");
  if (!publicKey) throw new Error("DISCORD_PUBLIC_KEY is not set");
  if (!applicationId) throw new Error("DISCORD_APPLICATION_ID is not set");
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set");
  if (!reviewChannelId) throw new Error("DISCORD_REVIEW_CHANNEL_ID is not set");
  if (!redisUrl) throw new Error("REDIS_URL is not set");

  return {
    botToken,
    publicKey,
    applicationId,
    guildId,
    reviewChannelId,
    redisUrl,
  };
}

function toReviewChannelId(guildId: string, reviewChannelId: string): string {
  return `discord:${guildId}:${reviewChannelId}`;
}

function registerHandlers(
  bot: Chat<{ discord: ReturnType<typeof createDiscordAdapter> }>,
): void {
  if (handlersRegistered) {
    return;
  }

  bot.onAction("approve-luma-event", async (event) => {
    const eventId = event.value?.trim();
    if (!eventId) {
      await event.thread.post("Approval failed: missing event reference.");
      return;
    }

    const approvalResult = await approveDiscordReviewSessionByEventId({
      eventId,
      approvalMessageId: event.messageId,
    });

    if (approvalResult.status === "approved") {
      await event.thread.post(
        `Approved by ${event.user.fullName}. Event is now live.`,
      );
      return;
    }

    if (approvalResult.status === "already_approved") {
      await event.thread.post("This event was already approved.");
      return;
    }

    await event.thread.post("No pending review session found for this event.");
  });

  const isPromptChannelMessage = (thread: Thread): boolean => {
    const { reviewChannelId } = requireDiscordConfig();
    const discordAdapter = bot.getAdapter("discord");
    const decodedThread = discordAdapter.decodeThreadId(thread.id);
    return decodedThread.channelId === reviewChannelId;
  };

  const promptFromMessage = async (thread: Thread, message: Message) => {
    if (!isPromptChannelMessage(thread)) {
      return;
    }

    const userPrompt = message.text?.trim();
    if (!userPrompt || userPrompt.length < 2) {
      return;
    }

    try {
      await thread.startTyping();
      const recentMessages: RecentMessageContext[] = [];
      for await (const recentMessage of thread.messages) {
        const text = recentMessage.text?.trim();
        if (!text) {
          continue;
        }
        recentMessages.push({
          author:
            recentMessage.author.fullName ||
            recentMessage.author.userName ||
            recentMessage.author.userId,
          text,
          isBot: recentMessage.author.isBot === true,
        });
        if (recentMessages.length >= 30) {
          break;
        }
      }
      recentMessages.reverse();

      const response = await runDiscordPromptAgent({
        prompt: userPrompt.slice(0, 4000),
        recentMessages,
      });
      await thread.post(response || "I couldn't generate a response.");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await thread.post(
        `I hit an error while processing that request: ${errorMessage}`,
      );
    }
  };

  bot.onNewMessage(/\S+/, async (thread, message) => {
    await thread.subscribe();
    await promptFromMessage(thread, message);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await promptFromMessage(thread, message);
  });

  handlersRegistered = true;
}

export function getDiscordReviewBot(): Chat<{
  discord: ReturnType<typeof createDiscordAdapter>;
}> {
  if (!reviewBot) {
    const { botToken, publicKey, applicationId, redisUrl } =
      requireDiscordConfig();

    reviewBot = new Chat({
      userName: "allthingsweb",
      adapters: {
        discord: createDiscordAdapter({
          botToken,
          publicKey,
          applicationId,
        }),
      },
      state: createRedisState({
        url: redisUrl,
        keyPrefix: "allthingsweb-chat",
      }),
    });
  }

  registerHandlers(reviewBot);
  return reviewBot;
}

export async function postEventReviewCard(
  input: ReviewCardInput,
): Promise<{ channelId: string; rootMessageId: string }> {
  const { guildId, reviewChannelId } = requireDiscordConfig();
  const bot = getDiscordReviewBot();
  const channelId = toReviewChannelId(guildId, reviewChannelId);
  const channel = bot.channel(channelId);

  const sentMessage = await channel.post(
    Card({
      title: `New Luma event draft: ${input.name}`,
      children: [
        CardText(
          "Review this event draft and approve when it is ready to publish.",
        ),
        Fields([
          Field({ label: "Event ID", value: input.eventId }),
          Field({ label: "Slug", value: input.slug }),
          Field({ label: "Luma Event ID", value: input.lumaEventId ?? "n/a" }),
          Field({ label: "Draft", value: input.isDraft ? "true" : "false" }),
          Field({
            label: "Start",
            value: new Date(input.startDate).toISOString().slice(0, 16),
          }),
          Field({
            label: "End",
            value: new Date(input.endDate).toISOString().slice(0, 16),
          }),
          Field({
            label: "Attendee Limit",
            value: String(input.attendeeLimit),
          }),
        ]),
        CardText(input.tagline),
        Actions([
          Button({
            id: "approve-luma-event",
            value: input.eventId,
            style: "primary",
            label: "Approve",
          }),
        ]),
      ],
    }),
  );

  return {
    channelId: reviewChannelId,
    rootMessageId: sentMessage.id,
  };
}
