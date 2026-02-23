import type { LumaEvent } from "@/lib/luma";
import { generateEventDraftWithAI } from "./steps/ai";
import {
  createDiscordReviewThreadForEvent,
  pollDiscordThreadForApproval,
} from "./steps/discord";
import {
  createDiscordReviewSession,
  createEventFromDraft,
  getExistingLumaEventIds,
  listPendingDiscordReviewSessions,
  resolveUniqueSlug,
  set_live_after_explicit_approval,
  updateDiscordReviewSessionCursor,
} from "./steps/events";
import { fetchLatestLumaEvents, getLumaEventId } from "./steps/luma";
import type {
  AISuggestedEvent,
  EventDraft,
  LumaSyncError,
  LumaSyncInput,
  LumaSyncResult,
} from "./types";

function normalizeSlugPart(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-{2,}/g, "-");
}

function cleanNullableText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeAttendeeLimit(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, 50000);
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[>*_`#\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(rawValue: string, fieldName: string): string {
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${rawValue}`);
  }

  return date.toISOString();
}

function buildFallbackTagline(event: LumaEvent): string {
  const rawDescription = event.description_md ?? event.description ?? "";
  const plainText = stripMarkdown(rawDescription);

  if (plainText.length > 0) {
    const sentenceCandidate = plainText.split(/[.!?](?:\s|$)/)[0] ?? plainText;
    return sentenceCandidate.slice(0, 180).trim();
  }

  return `${event.name} at All Things Web`;
}

function deriveEventDraft(
  lumaEvent: LumaEvent,
  lumaEventId: string,
): EventDraft {
  const startDate = toIsoDate(lumaEvent.start_at, "start_at");
  const endDate = toIsoDate(lumaEvent.end_at, "end_at");
  const datePrefix = startDate.slice(0, 10);

  const slugBase = normalizeSlugPart(`${datePrefix}-${lumaEvent.name}`);
  const geoAddress = lumaEvent.geo_address_json;

  return {
    name: lumaEvent.name.trim(),
    startDate,
    endDate,
    slug: slugBase || `${datePrefix}-event`,
    tagline: buildFallbackTagline(lumaEvent),
    attendeeLimit: 200,
    streetAddress: cleanNullableText(geoAddress?.address),
    shortLocation: cleanNullableText(
      geoAddress?.city_state ?? geoAddress?.city,
    ),
    fullAddress: cleanNullableText(
      geoAddress?.full_address ?? geoAddress?.description,
    ),
    lumaEventId,
    isDraft: true,
  };
}

function mergeAISuggestedDraft(
  fallbackDraft: EventDraft,
  aiSuggestedDraft: AISuggestedEvent,
): EventDraft {
  return {
    ...fallbackDraft,
    name: aiSuggestedDraft.name.trim() || fallbackDraft.name,
    slug: normalizeSlugPart(aiSuggestedDraft.slug) || fallbackDraft.slug,
    tagline: aiSuggestedDraft.tagline.trim() || fallbackDraft.tagline,
    attendeeLimit: sanitizeAttendeeLimit(
      aiSuggestedDraft.attendeeLimit,
      fallbackDraft.attendeeLimit,
    ),
    streetAddress:
      cleanNullableText(aiSuggestedDraft.streetAddress) ??
      fallbackDraft.streetAddress,
    shortLocation:
      cleanNullableText(aiSuggestedDraft.shortLocation) ??
      fallbackDraft.shortLocation,
    fullAddress:
      cleanNullableText(aiSuggestedDraft.fullAddress) ??
      fallbackDraft.fullAddress,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

export async function syncLumaEventsWorkflow(
  input: LumaSyncInput = {},
): Promise<LumaSyncResult> {
  "use workflow";

  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const calendarApiId = input.calendarApiId ?? undefined;
  const calendarHandle = input.calendarHandle ?? "allthingswebcalendar";

  const lumaEvents = await fetchLatestLumaEvents({
    limit,
    calendarApiId,
    calendarHandle,
  });

  const uniqueEvents: Array<{ lumaEventId: string; event: LumaEvent }> = [];
  const seenEventIds = new Set<string>();

  for (const event of lumaEvents) {
    const lumaEventId = getLumaEventId(event);
    if (!lumaEventId || seenEventIds.has(lumaEventId)) {
      continue;
    }

    seenEventIds.add(lumaEventId);
    uniqueEvents.push({ lumaEventId, event });

    if (uniqueEvents.length >= limit) {
      break;
    }
  }

  const eventIds = uniqueEvents.map((item) => item.lumaEventId);
  const existingLumaEventIds = await getExistingLumaEventIds(eventIds);
  const existingLumaEventIdSet = new Set(existingLumaEventIds);

  const createdEvents: LumaSyncResult["createdEvents"] = [];
  const errors: LumaSyncError[] = [];

  for (const item of uniqueEvents) {
    if (existingLumaEventIdSet.has(item.lumaEventId)) {
      continue;
    }

    let eventDraft: EventDraft;

    try {
      const fallbackDraft = deriveEventDraft(item.event, item.lumaEventId);

      try {
        const aiSuggestedDraft = await generateEventDraftWithAI({
          lumaEvent: item.event,
          derivedDraft: fallbackDraft,
        });
        eventDraft = mergeAISuggestedDraft(fallbackDraft, aiSuggestedDraft);
      } catch (aiError) {
        errors.push({
          scope: "import",
          reference: item.lumaEventId,
          error: `AI generation failed: ${toErrorMessage(aiError)}`,
        });
        eventDraft = fallbackDraft;
      }

      eventDraft.slug = await resolveUniqueSlug(eventDraft.slug);

      const createdEvent = await createEventFromDraft(eventDraft);
      if (createdEvent) {
        createdEvents.push(createdEvent);

        try {
          const reviewThread =
            await createDiscordReviewThreadForEvent(createdEvent);
          await createDiscordReviewSession({
            eventId: createdEvent.id,
            channelId: reviewThread.channelId,
            rootMessageId: reviewThread.rootMessageId,
            threadId: reviewThread.threadId,
            lastSeenMessageId: reviewThread.lastSeenMessageId,
          });
        } catch (reviewSetupError) {
          errors.push({
            scope: "review",
            reference: createdEvent.id,
            error: `Failed to create Discord review thread: ${toErrorMessage(
              reviewSetupError,
            )}`,
          });
        }
      }
    } catch (error) {
      errors.push({
        scope: "import",
        reference: item.lumaEventId,
        error: toErrorMessage(error),
      });
    }
  }

  const pendingReviewSessions = await listPendingDiscordReviewSessions(100);
  let approvedCount = 0;

  for (const session of pendingReviewSessions) {
    try {
      const reviewScanResult = await pollDiscordThreadForApproval({
        threadId: session.threadId,
        afterMessageId: session.lastSeenMessageId,
      });

      if (reviewScanResult.approvalMessageId) {
        const updated = await set_live_after_explicit_approval({
          reviewSessionId: session.id,
          eventId: session.eventId,
          approvalMessageId: reviewScanResult.approvalMessageId,
        });

        if (updated) {
          approvedCount += 1;
        }

        continue;
      }

      if (
        reviewScanResult.latestSeenMessageId &&
        reviewScanResult.latestSeenMessageId !== session.lastSeenMessageId
      ) {
        await updateDiscordReviewSessionCursor(
          session.id,
          reviewScanResult.latestSeenMessageId,
        );
      }
    } catch (reviewError) {
      errors.push({
        scope: "review",
        reference: session.id,
        error: toErrorMessage(reviewError),
      });
    }
  }

  return {
    fetchedCount: uniqueEvents.length,
    skippedExistingCount: existingLumaEventIds.length,
    createdCount: createdEvents.length,
    approvedCount,
    createdEvents,
    skippedEventIds: existingLumaEventIds,
    errors,
  };
}
