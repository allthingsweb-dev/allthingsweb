import { z } from "zod";

export const aiSuggestedEventSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200),
  tagline: z.string().trim().min(1).max(280),
  attendeeLimit: z.number().int().positive().max(50000),
  streetAddress: z.string().trim().min(1).max(300).nullable().optional(),
  shortLocation: z.string().trim().min(1).max(160).nullable().optional(),
  fullAddress: z.string().trim().min(1).max(500).nullable().optional(),
});

export type AISuggestedEvent = z.infer<typeof aiSuggestedEventSchema>;

export type EventDraft = {
  name: string;
  startDate: string;
  endDate: string;
  slug: string;
  tagline: string;
  attendeeLimit: number;
  streetAddress: string | null;
  shortLocation: string | null;
  fullAddress: string | null;
  lumaEventId: string;
  isDraft: boolean;
};

export type LumaSyncInput = {
  limit?: number;
  calendarApiId?: string | null;
  calendarHandle?: string | null;
};

export type LumaSyncCreatedEvent = {
  id: string;
  name: string;
  slug: string;
  lumaEventId: string | null;
};

export type LumaSyncError = {
  lumaEventId: string;
  error: string;
};

export type LumaSyncResult = {
  fetchedCount: number;
  skippedExistingCount: number;
  createdCount: number;
  createdEvents: LumaSyncCreatedEvent[];
  skippedEventIds: string[];
  errors: LumaSyncError[];
};
