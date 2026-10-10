-- A draft evening's log and its notes, decisions and questions, private in planning; core/migrations/0028_draft_log.ts is the same change.
CREATE TABLE "planning"."draft_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"command" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "draft_log_actor_check" CHECK ("actor" ~ '^[a-z0-9][a-z0-9._-]{0,31}(/[a-z0-9][a-z0-9._-]{0,31})?$'),
	CONSTRAINT "draft_log_command_check" CHECK (char_length("command") <= 80 AND "command" ~ '^[a-z][a-z0-9:-]*( [a-z0-9:-]+)*$'),
	CONSTRAINT "draft_log_summary_check" CHECK (btrim("summary") <> '' AND char_length("summary") <= 500 AND "summary" !~* '[a-z0-9._%+-]+@[a-z0-9-]+([.][a-z0-9-]+)+'),
	CONSTRAINT "draft_log_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 8000 AND "payload"::text !~* '[a-z0-9._%+-]+@[a-z0-9-]+([.][a-z0-9-]+)+')
);
--> statement-breakpoint
CREATE TABLE "planning"."draft_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "draft_notes_actor_check" CHECK ("actor" ~ '^[a-z0-9][a-z0-9._-]{0,31}(/[a-z0-9][a-z0-9._-]{0,31})?$'),
	CONSTRAINT "draft_notes_kind_check" CHECK ("kind" IN ('note', 'decision', 'question')),
	CONSTRAINT "draft_notes_text_check" CHECK (btrim("text") <> '' AND char_length("text") <= 2000),
	CONSTRAINT "draft_notes_resolved_check" CHECK ("resolved_at" IS NULL OR ("kind" = 'question' AND "resolved_at" >= "at"))
);
--> statement-breakpoint
CREATE INDEX "draft_log_event_id_at_idx" ON "planning"."draft_log" USING btree ("event_id","at");--> statement-breakpoint
CREATE INDEX "draft_notes_event_id_at_idx" ON "planning"."draft_notes" USING btree ("event_id","at");--> statement-breakpoint
CREATE FUNCTION "planning"."draft_log_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'planning.draft_log is append-only: % refused', TG_OP;
END
$$;--> statement-breakpoint
CREATE TRIGGER "draft_log_append_only" BEFORE UPDATE OR DELETE ON "planning"."draft_log" FOR EACH ROW EXECUTE FUNCTION "planning"."draft_log_append_only"();--> statement-breakpoint
CREATE TRIGGER "draft_log_no_truncate" BEFORE TRUNCATE ON "planning"."draft_log" FOR EACH STATEMENT EXECUTE FUNCTION "planning"."draft_log_append_only"();--> statement-breakpoint
CREATE FUNCTION "planning"."draft_notes_written_once"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
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
$$;--> statement-breakpoint
CREATE TRIGGER "draft_notes_written_once" BEFORE UPDATE OR DELETE ON "planning"."draft_notes" FOR EACH ROW EXECUTE FUNCTION "planning"."draft_notes_written_once"();--> statement-breakpoint
CREATE TRIGGER "draft_notes_no_truncate" BEFORE TRUNCATE ON "planning"."draft_notes" FOR EACH STATEMENT EXECUTE FUNCTION "planning"."draft_notes_written_once"();--> statement-breakpoint
REVOKE ALL ON FUNCTION "planning"."draft_log_append_only"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "planning"."draft_notes_written_once"() FROM PUBLIC;
