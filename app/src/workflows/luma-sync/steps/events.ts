import { db } from "@/lib/db";
import { approveDiscordReviewSessionByEventId } from "@/lib/review/approval";
import { eventReviewSessionsTable, eventsTable } from "@/lib/schema";
import { and, eq, inArray, like, or } from "drizzle-orm";
import type { EventDraft, LumaSyncCreatedEvent } from "../types";

function normalizeSlugPart(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-{2,}/g, "-");
}

function toInsertDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return date;
}

export async function getExistingLumaEventIds(
  lumaEventIds: string[],
): Promise<string[]> {
  "use step";

  if (lumaEventIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({ lumaEventId: eventsTable.lumaEventId })
    .from(eventsTable)
    .where(inArray(eventsTable.lumaEventId, lumaEventIds));

  return rows
    .map((row) => row.lumaEventId)
    .filter((lumaEventId): lumaEventId is string => Boolean(lumaEventId));
}

export async function resolveUniqueSlug(desiredSlug: string): Promise<string> {
  "use step";

  const baseSlug = normalizeSlugPart(desiredSlug) || `event-${Date.now()}`;

  const rows = await db
    .select({ slug: eventsTable.slug })
    .from(eventsTable)
    .where(
      or(
        eq(eventsTable.slug, baseSlug),
        like(eventsTable.slug, `${baseSlug}-%`),
      ),
    );

  const existingSlugs = new Set(rows.map((row) => row.slug));
  if (!existingSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let counter = 2;
  while (existingSlugs.has(`${baseSlug}-${counter}`)) {
    counter += 1;
  }

  return `${baseSlug}-${counter}`;
}

export async function createEventFromDraft(
  draft: EventDraft,
): Promise<LumaSyncCreatedEvent | null> {
  "use step";

  const [created] = await db
    .insert(eventsTable)
    .values({
      name: draft.name,
      startDate: toInsertDate(draft.startDate),
      endDate: toInsertDate(draft.endDate),
      slug: draft.slug,
      tagline: draft.tagline,
      attendeeLimit: draft.attendeeLimit,
      streetAddress: draft.streetAddress,
      shortLocation: draft.shortLocation,
      fullAddress: draft.fullAddress,
      lumaEventId: draft.lumaEventId,
      isDraft: draft.isDraft,
    })
    .onConflictDoNothing({ target: eventsTable.lumaEventId })
    .returning({
      id: eventsTable.id,
      name: eventsTable.name,
      slug: eventsTable.slug,
      startDate: eventsTable.startDate,
      endDate: eventsTable.endDate,
      tagline: eventsTable.tagline,
      attendeeLimit: eventsTable.attendeeLimit,
      isDraft: eventsTable.isDraft,
      lumaEventId: eventsTable.lumaEventId,
    });

  return created ?? null;
}

export type PendingDiscordReviewSession = {
  id: string;
  eventId: string;
  threadId: string;
  lastSeenMessageId: string | null;
};

export async function createDiscordReviewSession(input: {
  eventId: string;
  channelId: string;
  rootMessageId: string;
  threadId: string;
  lastSeenMessageId: string | null;
}): Promise<void> {
  "use step";

  await db
    .insert(eventReviewSessionsTable)
    .values({
      eventId: input.eventId,
      provider: "discord",
      channelId: input.channelId,
      rootMessageId: input.rootMessageId,
      threadId: input.threadId,
      lastSeenMessageId: input.lastSeenMessageId,
      status: "pending",
      approvalMessageId: null,
    })
    .onConflictDoUpdate({
      target: eventReviewSessionsTable.eventId,
      set: {
        provider: "discord",
        channelId: input.channelId,
        rootMessageId: input.rootMessageId,
        threadId: input.threadId,
        lastSeenMessageId: input.lastSeenMessageId,
        status: "pending",
        approvalMessageId: null,
      },
    });
}

export async function listPendingDiscordReviewSessions(
  limit = 100,
): Promise<PendingDiscordReviewSession[]> {
  "use step";

  return db
    .select({
      id: eventReviewSessionsTable.id,
      eventId: eventReviewSessionsTable.eventId,
      threadId: eventReviewSessionsTable.threadId,
      lastSeenMessageId: eventReviewSessionsTable.lastSeenMessageId,
    })
    .from(eventReviewSessionsTable)
    .where(
      and(
        eq(eventReviewSessionsTable.provider, "discord"),
        eq(eventReviewSessionsTable.status, "pending"),
      ),
    )
    .limit(limit);
}

export async function updateDiscordReviewSessionCursor(
  reviewSessionId: string,
  lastSeenMessageId: string,
): Promise<void> {
  "use step";

  await db
    .update(eventReviewSessionsTable)
    .set({
      lastSeenMessageId,
    })
    .where(eq(eventReviewSessionsTable.id, reviewSessionId));
}

export async function set_live_after_explicit_approval({
  reviewSessionId,
  eventId,
  approvalMessageId,
}: {
  reviewSessionId: string;
  eventId: string;
  approvalMessageId: string;
}): Promise<boolean> {
  "use step";
  const result = await approveDiscordReviewSessionByEventId({
    eventId,
    approvalMessageId,
  });

  return result.status === "approved" || result.status === "already_approved";
}

export const setLiveAfterExplicitApproval = set_live_after_explicit_approval;
