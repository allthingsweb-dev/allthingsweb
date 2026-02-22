import { db } from "@/lib/db";
import { eventsTable } from "@/lib/schema";
import { eq, inArray, like, or } from "drizzle-orm";
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
      lumaEventId: eventsTable.lumaEventId,
    });

  return created ?? null;
}
