import { statements } from "./statements.ts";

/**
 * The talks of an evening that isn't published yet, a panel or fireside
 * included, and who is on them (README, "Draft talks"). The people on a
 * draft talk may not have said yes, or have no profile yet, so the talk is
 * kept in planning, never in the public talks tables, until publishing
 * copies it.
 *
 * - `draft_talks`: one evening's talks, in running order from 1, each a
 *   talk, a panel or a fireside, with a title and maybe a description.
 * - `draft_talk_people`: who is on each, by the wanted speaker planning
 *   keeps for them (planning.wanted_speakers), so whether they've said yes
 *   is that record's status and never kept twice; as a speaker, panelist
 *   or moderator, in order from 0.
 *
 * In the planning schema, so neither site role can read or write them
 * (tests/planning-privacy.test.ts), and no grant gives them to the draft
 * collaboration role. Ships with the app's drizzle migration
 * 0039_draft_talks, which makes the same schema.
 */
export const draftTalks: ReadonlyArray<string> = [
  `CREATE TABLE "planning"."draft_talks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "kind" text NOT NULL,
    "title" text NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "draft_talks_event_id_position_unique" UNIQUE ("event_id", "position"),
    CONSTRAINT "draft_talks_position_check" CHECK ("position" > 0),
    CONSTRAINT "draft_talks_kind_check" CHECK ("kind" IN ('talk', 'panel', 'fireside')),
    CONSTRAINT "draft_talks_title_check" CHECK (btrim("title") <> '' AND char_length("title") <= 120),
    CONSTRAINT "draft_talks_description_check" CHECK (btrim("description") <> '' AND char_length("description") <= 4000)
  )`,
  `CREATE TABLE "planning"."draft_talk_people" (
    "draft_talk_id" uuid NOT NULL,
    "wanted_speaker_id" uuid NOT NULL,
    "role" text NOT NULL,
    "position" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "draft_talk_people_draft_talk_id_wanted_speaker_id_pk" PRIMARY KEY ("draft_talk_id", "wanted_speaker_id"),
    CONSTRAINT "draft_talk_people_draft_talk_id_position_unique" UNIQUE ("draft_talk_id", "position"),
    CONSTRAINT "draft_talk_people_role_check" CHECK ("role" IN ('speaker', 'panelist', 'moderator')),
    CONSTRAINT "draft_talk_people_position_check" CHECK ("position" >= 0)
  )`,
  `ALTER TABLE "planning"."draft_talk_people" ADD CONSTRAINT "draft_talk_people_draft_talk_id_draft_talks_id_fk" FOREIGN KEY ("draft_talk_id") REFERENCES "planning"."draft_talks"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "planning"."draft_talk_people" ADD CONSTRAINT "draft_talk_people_wanted_speaker_id_wanted_speakers_id_fk" FOREIGN KEY ("wanted_speaker_id") REFERENCES "planning"."wanted_speakers"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "planning"."draft_talks" ADD CONSTRAINT "draft_talks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action`,
];

export default statements(draftTalks);
