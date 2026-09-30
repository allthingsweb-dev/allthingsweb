import { createCollection } from "@tanstack/react-db";
import { electricCollectionOptions } from "@tanstack/electric-db-collection";
import { z } from "zod";

const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  slug: z.string(),
  tagline: z.string(),
  attendee_limit: z.number(),
  street_address: z.string().nullable(),
  short_location: z.string().nullable(),
  full_address: z.string().nullable(),
  luma_event_id: z.string().nullable(),
  is_hackathon: z.boolean(),
  is_draft: z.boolean(),
  highlight_on_landing_page: z.boolean(),
  preview_image: z.string().nullable(),
  recording_url: z.string().nullable(),
  // Hackathon-specific fields
  hackathon_state: z
    .enum(["before_start", "hacking", "voting", "ended"])
    .nullable(),
  hack_started_at: z.string().nullable(),
  hack_until: z.string().nullable(),
  vote_started_at: z.string().nullable(),
  vote_until: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const getShapeUrl = () => {
  // Safe to assume window is available in client components wrapped with ClientOnly
  return `${window.location.origin}/api/v1/shapes`;
};

// Events Collection
export const eventsCollection = createCollection(
  electricCollectionOptions({
    id: "events",
    shapeOptions: {
      url: `${getShapeUrl()}/events`,
      params: {
        table: "events",
      },
    },
    getKey: (item) => item.id,
    schema: eventSchema,
  }),
);
