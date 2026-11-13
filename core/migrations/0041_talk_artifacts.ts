import { statements } from "./statements.ts";

/**
 * What a talk left behind: its recording, its slides, its code, its site
 * (src/talk-artifacts.ts). One row per link, so the recorder in the room,
 * a speaker sharing their slides, or a sourced backfill can each add one
 * without a new column.
 *
 * - `kind`: recording, slides, repo, site or other.
 * - `url`: https only, once per talk.
 * - `label`: what the link is, in a few words, where its kind doesn't say
 *   enough ("Codebuff, the agent he demoed").
 * - `start_seconds`: where the talk starts in a recording of the whole
 *   evening, for a recording only.
 * - `elsewhere`: for the same talk given somewhere else, where (a
 *   conference, another meetup); null for what comes from our evening. The
 *   talk's own recording is its first recording with none.
 * - `position`: the order its links are shown in, from 0.
 * - `source_url`, `read_on`: where it was confirmed, and on what day, for
 *   a link someone found rather than one the speaker or the room gave.
 *
 * A talk's links go with it when it is deleted. Production's read-only
 * role, site_reader, gets SELECT here where it exists
 * (infra/scripts/site-reader.ts reads src/site-tables.ts, which lists it).
 */
export const talkArtifacts: ReadonlyArray<string> = [
  `CREATE TABLE "public"."talk_artifacts" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "talk_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "url" text NOT NULL,
    "label" text,
    "start_seconds" integer,
    "elsewhere" text,
    "position" integer NOT NULL,
    "source_url" text,
    "read_on" date,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "talk_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "talk_artifacts_talk_id_url_unique" UNIQUE ("talk_id", "url"),
    CONSTRAINT "talk_artifacts_kind_check" CHECK ("kind" IN ('recording', 'slides', 'repo', 'site', 'other')),
    CONSTRAINT "talk_artifacts_url_check" CHECK ("url" ~ '^https://[^[:space:]]+$' AND char_length("url") <= 2000),
    CONSTRAINT "talk_artifacts_label_check" CHECK (btrim("label") = "label" AND "label" <> '' AND char_length("label") <= 120),
    CONSTRAINT "talk_artifacts_start_seconds_check" CHECK ("start_seconds" IS NULL OR ("start_seconds" >= 0 AND "kind" = 'recording')),
    CONSTRAINT "talk_artifacts_elsewhere_check" CHECK (btrim("elsewhere") = "elsewhere" AND "elsewhere" <> '' AND char_length("elsewhere") <= 120),
    CONSTRAINT "talk_artifacts_position_check" CHECK ("position" >= 0),
    CONSTRAINT "talk_artifacts_source_url_check" CHECK ("source_url" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "talk_artifacts_source_read_check" CHECK (("source_url" IS NULL) = ("read_on" IS NULL))
  )`,
  `ALTER TABLE "public"."talk_artifacts" ADD CONSTRAINT "talk_artifacts_talk_id_talks_id_fk" FOREIGN KEY ("talk_id") REFERENCES "public"."talks"("id") ON DELETE CASCADE`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_reader') THEN
      GRANT SELECT ON "public"."talk_artifacts" TO site_reader;
    END IF;
  END
  $grant$`,
];

export default statements(talkArtifacts);
