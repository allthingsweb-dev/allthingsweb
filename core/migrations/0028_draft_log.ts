import { statements } from "./statements.ts";

/**
 * What happened to a draft evening, and what its organizers said about it
 * (README, "A draft's log, notes and status"), private in planning:
 *
 * - `draft_log`: one row per studio write that touched the evening, made
 *   in the same transaction as the write (src/draft-log.ts), so a write
 *   that rolls back leaves no row. Who (`actor`, the ALLTHINGS_ACTOR the
 *   command ran with: a declared label, not proof of who it was), which
 *   command, a one-line summary, and what changed as a JSON object. Never
 *   a secret or a contact detail: no email in the summary or the payload,
 *   which a CHECK holds it to. Append-only: a trigger refuses any UPDATE,
 *   DELETE or TRUNCATE, the owner's too.
 * - `draft_notes`: a note, a decision or a question about the evening,
 *   with who wrote it and when. Each is written once: a trigger refuses any
 *   change but resolving an open question, once, and any DELETE or
 *   TRUNCATE.
 *
 * Both are kept even when their evening goes, as collab_audit is: no
 * foreign key to events, so neither keeps an evening from being deleted.
 *
 * Neither has row security: no role that reads planning is held to less
 * than the evening. In the planning schema, so neither site role can read
 * or write them (tests/planning-privacy.test.ts); the studio role may add
 * rows and read them, and resolve a question (infra/scripts/studio.ts).
 * PUBLIC may execute neither trigger function. Ships with the app's
 * drizzle migration 0040_draft_log, which makes the same schema.
 */

/** ALLTHINGS_ACTOR's shape: `erik`, `andre`, `erik/claude-work`. */
const actorRule = (column: string) =>
  `"${column}" ~ '^[a-z0-9][a-z0-9._-]{0,31}(/[a-z0-9][a-z0-9._-]{0,31})?$'`;

/** Anything shaped like an email address. */
const noEmail = (expression: string) =>
  `${expression} !~* '[a-z0-9._%+-]+@[a-z0-9-]+([.][a-z0-9-]+)+'`;

export const draftLog: ReadonlyArray<string> = [
  `CREATE TABLE "planning"."draft_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "at" timestamp with time zone DEFAULT now() NOT NULL,
    "actor" text NOT NULL,
    "command" text NOT NULL,
    "summary" text NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT "draft_log_actor_check" CHECK (${actorRule("actor")}),
    CONSTRAINT "draft_log_command_check" CHECK (char_length("command") <= 80 AND "command" ~ '^[a-z][a-z0-9:-]*( [a-z0-9:-]+)*$'),
    CONSTRAINT "draft_log_summary_check" CHECK (btrim("summary") <> '' AND char_length("summary") <= 500 AND ${noEmail(`"summary"`)}),
    CONSTRAINT "draft_log_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 8000 AND ${noEmail(`"payload"::text`)})
  )`,
  `CREATE INDEX "draft_log_event_id_at_idx" ON "planning"."draft_log" USING btree ("event_id", "at")`,
  `CREATE TABLE "planning"."draft_notes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "at" timestamp with time zone DEFAULT now() NOT NULL,
    "actor" text NOT NULL,
    "kind" text NOT NULL,
    "text" text NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "draft_notes_actor_check" CHECK (${actorRule("actor")}),
    CONSTRAINT "draft_notes_kind_check" CHECK ("kind" IN ('note', 'decision', 'question')),
    CONSTRAINT "draft_notes_text_check" CHECK (btrim("text") <> '' AND char_length("text") <= 2000),
    CONSTRAINT "draft_notes_resolved_check" CHECK ("resolved_at" IS NULL OR ("kind" = 'question' AND "resolved_at" >= "at"))
  )`,
  `CREATE INDEX "draft_notes_event_id_at_idx" ON "planning"."draft_notes" USING btree ("event_id", "at")`,
  `CREATE FUNCTION "planning"."draft_log_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'planning.draft_log is append-only: % refused', TG_OP;
END
$$`,
  `CREATE TRIGGER "draft_log_append_only" BEFORE UPDATE OR DELETE ON "planning"."draft_log" FOR EACH ROW EXECUTE FUNCTION "planning"."draft_log_append_only"()`,
  `CREATE TRIGGER "draft_log_no_truncate" BEFORE TRUNCATE ON "planning"."draft_log" FOR EACH STATEMENT EXECUTE FUNCTION "planning"."draft_log_append_only"()`,
  `CREATE FUNCTION "planning"."draft_notes_written_once"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.kind = 'question' AND OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL
      AND (NEW.id, NEW.event_id, NEW.at, NEW.actor, NEW.kind, NEW.text)
        IS NOT DISTINCT FROM (OLD.id, OLD.event_id, OLD.at, OLD.actor, OLD.kind, OLD.text) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'planning.draft_notes are written once; only an open question may be resolved: % refused', TG_OP;
END
$$`,
  `CREATE TRIGGER "draft_notes_written_once" BEFORE UPDATE OR DELETE ON "planning"."draft_notes" FOR EACH ROW EXECUTE FUNCTION "planning"."draft_notes_written_once"()`,
  `CREATE TRIGGER "draft_notes_no_truncate" BEFORE TRUNCATE ON "planning"."draft_notes" FOR EACH STATEMENT EXECUTE FUNCTION "planning"."draft_notes_written_once"()`,
  `REVOKE ALL ON FUNCTION "planning"."draft_log_append_only"() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION "planning"."draft_notes_written_once"() FROM PUBLIC`,
];

export default statements(draftLog);
