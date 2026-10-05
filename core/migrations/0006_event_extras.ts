import { statements } from "./statements.ts";

/**
 * What an event's page says beyond its record, for any event that needs it:
 * its schedule, and notes such as a hackathon's awards, theme and teams.
 * Ships with the app's drizzle migration 0018_event_extras, which makes the
 * same schema.
 *
 * - `event_schedule_items`: the event's schedule, in `position` order. `time`
 *   is as the organizers wrote it ("1 - 7 pm", "~7:00 pm"): a range or an
 *   approximation, not an instant.
 * - `event_notes`: a row of the event's page each, in `position` order, under
 *   `label` ("Awards", "Theme"). `body` is editor HTML, as talk descriptions
 *   are, and is sanitized the same way before it is shown.
 *
 * Production's read-only role, site_reader, may SELECT every table the
 * public site reads (infra/scripts/site-reader.ts), so both get the grant
 * here, where the role exists.
 */
export const eventExtras: ReadonlyArray<string> = [
  `CREATE TABLE "public"."event_schedule_items" (
    "event_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "time" text NOT NULL,
    "title" text NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_schedule_items_event_id_position_pk" PRIMARY KEY ("event_id", "position"),
    CONSTRAINT "event_schedule_items_position_check" CHECK ("position" >= 0),
    CONSTRAINT "event_schedule_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id")
  )`,
  `CREATE TABLE "public"."event_notes" (
    "event_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "label" text NOT NULL,
    "body" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "event_notes_event_id_position_pk" PRIMARY KEY ("event_id", "position"),
    CONSTRAINT "event_notes_position_check" CHECK ("position" >= 0),
    CONSTRAINT "event_notes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id")
  )`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."event_schedule_items", "public"."event_notes" TO site_reader;
    END IF;
  END
  $grant$`,
];

export default statements(eventExtras);
