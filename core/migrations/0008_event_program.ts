import { statements } from "./statements.ts";

/**
 * What kind of evening each event is, so a record is held to what that kind
 * has. Ships with the app's drizzle migration 0020_event_program, which
 * makes the same schema.
 *
 * - `talks`: a lineup on stage (talks, panels, fireside chats, fixed demos).
 *   The default: a new event from Luma is one until an organizer says
 *   otherwise.
 * - `open-floor`: community demos with no fixed lineup; anyone could get up.
 * - `social`: no stage at all: a hangout, trivia, an after-party.
 * - `hackathon`: building, then demos and awards.
 *
 * `is_hackathon`, which the public API still publishes, must say the same
 * as `program`; a check holds the two together until the column is dropped.
 * Existing hackathons become `hackathon` here; every other event's program
 * comes from a sourced backfill (backfill/programs.json).
 */
export const eventProgram: ReadonlyArray<string> = [
  `ALTER TABLE "public"."events" ADD COLUMN "program" text DEFAULT 'talks' NOT NULL`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_program_check" CHECK ("program" IN ('talks', 'open-floor', 'social', 'hackathon'))`,
  `UPDATE "public"."events" SET "program" = 'hackathon' WHERE "is_hackathon"`,
  `ALTER TABLE "public"."events" ADD CONSTRAINT "events_program_hackathon_check" CHECK (("program" = 'hackathon') = "is_hackathon")`,
];

export default statements(eventProgram);
