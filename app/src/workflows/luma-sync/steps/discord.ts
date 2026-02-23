import { mainConfig } from "@/lib/config";
import { getLumaUrl } from "@/lib/luma";
import type { LumaSyncCreatedEvent } from "../types";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

type DiscordMessageAuthor = {
  id: string;
  bot?: boolean;
};

type DiscordMessage = {
  id: string;
  content: string;
  author: DiscordMessageAuthor;
};

type DiscordCreatedMessage = {
  id: string;
  channel_id: string;
};

type DiscordThreadChannel = {
  id: string;
};

type DiscordConfig = {
  botToken: string;
  reviewChannelId: string;
};

export type DiscordReviewThread = {
  channelId: string;
  rootMessageId: string;
  threadId: string;
  lastSeenMessageId: string | null;
};

export type DiscordApprovalScanResult = {
  latestSeenMessageId: string | null;
  approvalMessageId: string | null;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function getDiscordConfig(): DiscordConfig {
  const botToken = mainConfig.discord.botToken;
  const reviewChannelId = mainConfig.discord.reviewChannelId;

  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN is not set");
  }

  if (!reviewChannelId) {
    throw new Error("DISCORD_REVIEW_CHANNEL_ID is not set");
  }

  return { botToken, reviewChannelId };
}

function compareSnowflakeIds(a: string, b: string): number {
  try {
    const aValue = BigInt(a);
    const bValue = BigInt(b);
    if (aValue === bValue) return 0;
    return aValue > bValue ? 1 : -1;
  } catch {
    return a.localeCompare(b);
  }
}

function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  const safeLength = Math.max(maxLength - 3, 1);
  return `${input.slice(0, safeLength)}...`;
}

function toOneLine(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function toIsoString(value: Date): string {
  return new Date(value).toISOString();
}

function buildRootReviewMessage(event: LumaSyncCreatedEvent): string {
  return [
    `New Luma event draft: **${event.name}**`,
    `Event ID: \`${event.id}\``,
    "Reply with `Approved` in this thread to publish.",
  ].join("\n");
}

function buildThreadName(eventName: string): string {
  const base = `review-${toOneLine(eventName).toLowerCase()}`;
  return truncateText(base, 95);
}

function buildDraftDetailsMessage(event: LumaSyncCreatedEvent): string {
  const lumaUrl = getLumaUrl(event.lumaEventId);
  const details = [
    "Draft event details:",
    `- id: ${event.id}`,
    `- name: ${event.name}`,
    `- slug: ${event.slug}`,
    `- startDate: ${toIsoString(event.startDate)}`,
    `- endDate: ${toIsoString(event.endDate)}`,
    `- tagline: ${truncateText(toOneLine(event.tagline), 220)}`,
    `- attendeeLimit: ${event.attendeeLimit}`,
    `- lumaEventId: ${event.lumaEventId ?? "n/a"}`,
    `- lumaUrl: ${lumaUrl ?? "n/a"}`,
    `- isDraft: ${event.isDraft}`,
    "",
    "Reply with exactly `Approved` to set `isDraft` to `false`.",
  ].join("\n");

  return truncateText(details, DISCORD_MAX_MESSAGE_LENGTH);
}

function isExplicitApprovalMessage(content: string): boolean {
  return /^approved[.!]*$/i.test(content.trim());
}

async function discordRequest<T>(
  path: string,
  init: RequestInit,
  botToken: string,
): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const responseText = await response.text();
  const responseData =
    responseText.length > 0 ? JSON.parse(responseText) : null;

  if (!response.ok) {
    throw new Error(
      `Discord API request failed (${response.status}): ${
        typeof responseData === "object" &&
        responseData &&
        "message" in responseData
          ? String(responseData.message)
          : responseText
      }`,
    );
  }

  return responseData as T;
}

async function postChannelMessage(
  channelId: string,
  content: string,
  botToken: string,
): Promise<DiscordCreatedMessage> {
  return discordRequest<DiscordCreatedMessage>(
    `/channels/${channelId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
    botToken,
  );
}

async function createThreadFromMessage(
  channelId: string,
  messageId: string,
  name: string,
  botToken: string,
): Promise<DiscordThreadChannel> {
  return discordRequest<DiscordThreadChannel>(
    `/channels/${channelId}/messages/${messageId}/threads`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        auto_archive_duration: 1440,
      }),
    },
    botToken,
  );
}

async function listThreadMessages(
  threadId: string,
  botToken: string,
  afterMessageId: string | null,
): Promise<DiscordMessage[]> {
  const searchParams = new URLSearchParams({
    limit: "100",
  });
  if (afterMessageId) {
    searchParams.set("after", afterMessageId);
  }

  return discordRequest<DiscordMessage[]>(
    `/channels/${threadId}/messages?${searchParams.toString()}`,
    {
      method: "GET",
    },
    botToken,
  );
}

export async function createDiscordReviewThreadForEvent(
  event: LumaSyncCreatedEvent,
): Promise<DiscordReviewThread> {
  "use step";

  const { botToken, reviewChannelId } = getDiscordConfig();
  const rootMessage = await postChannelMessage(
    reviewChannelId,
    buildRootReviewMessage(event),
    botToken,
  );

  const thread = await createThreadFromMessage(
    reviewChannelId,
    rootMessage.id,
    buildThreadName(event.name),
    botToken,
  );

  const detailsMessage = await postChannelMessage(
    thread.id,
    buildDraftDetailsMessage(event),
    botToken,
  );

  return {
    channelId: reviewChannelId,
    rootMessageId: rootMessage.id,
    threadId: thread.id,
    lastSeenMessageId: detailsMessage.id,
  };
}

export async function pollDiscordThreadForApproval({
  threadId,
  afterMessageId,
}: {
  threadId: string;
  afterMessageId: string | null;
}): Promise<DiscordApprovalScanResult> {
  "use step";

  const { botToken } = getDiscordConfig();

  let messages: DiscordMessage[] = [];
  try {
    messages = await listThreadMessages(threadId, botToken, afterMessageId);
  } catch (error) {
    throw new Error(
      `Failed to poll Discord thread ${threadId}: ${toErrorMessage(error)}`,
    );
  }

  if (messages.length === 0) {
    return {
      latestSeenMessageId: null,
      approvalMessageId: null,
    };
  }

  messages.sort((left, right) => compareSnowflakeIds(left.id, right.id));

  let latestSeenMessageId: string | null = afterMessageId;
  let approvalMessageId: string | null = null;

  for (const message of messages) {
    if (
      !latestSeenMessageId ||
      compareSnowflakeIds(message.id, latestSeenMessageId) > 0
    ) {
      latestSeenMessageId = message.id;
    }

    if (message.author.bot) {
      continue;
    }

    if (isExplicitApprovalMessage(message.content) && !approvalMessageId) {
      approvalMessageId = message.id;
    }
  }

  return {
    latestSeenMessageId,
    approvalMessageId,
  };
}
