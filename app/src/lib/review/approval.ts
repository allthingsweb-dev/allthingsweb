import { db } from "@/lib/db";
import { eventReviewSessionsTable, eventsTable } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

export type ApproveReviewSessionResult =
  | { status: "approved"; reviewSessionId: string }
  | { status: "already_approved"; reviewSessionId: string }
  | { status: "not_found" };

export async function approveDiscordReviewSessionByEventId(input: {
  eventId: string;
  approvalMessageId: string;
}): Promise<ApproveReviewSessionResult> {
  const [pendingSession] = await db
    .select({
      id: eventReviewSessionsTable.id,
      eventId: eventReviewSessionsTable.eventId,
    })
    .from(eventReviewSessionsTable)
    .where(
      and(
        eq(eventReviewSessionsTable.eventId, input.eventId),
        eq(eventReviewSessionsTable.provider, "discord"),
        eq(eventReviewSessionsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (!pendingSession) {
    const [approvedSession] = await db
      .select({
        id: eventReviewSessionsTable.id,
      })
      .from(eventReviewSessionsTable)
      .where(
        and(
          eq(eventReviewSessionsTable.eventId, input.eventId),
          eq(eventReviewSessionsTable.provider, "discord"),
          eq(eventReviewSessionsTable.status, "approved"),
        ),
      )
      .limit(1);

    if (!approvedSession) {
      return { status: "not_found" };
    }

    return {
      status: "already_approved",
      reviewSessionId: approvedSession.id,
    };
  }

  await db
    .update(eventsTable)
    .set({
      isDraft: false,
    })
    .where(and(eq(eventsTable.id, pendingSession.eventId), eq(eventsTable.isDraft, true)));

  await db
    .update(eventReviewSessionsTable)
    .set({
      status: "approved",
      approvalMessageId: input.approvalMessageId,
      lastSeenMessageId: input.approvalMessageId,
    })
    .where(eq(eventReviewSessionsTable.id, pendingSession.id));

  return {
    status: "approved",
    reviewSessionId: pendingSession.id,
  };
}
