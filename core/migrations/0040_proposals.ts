import { statements } from "./statements.ts";

/**
 * `planning.proposals`: talks people propose to give at one of our
 * evenings (src/proposals.ts, `bun run proposals`), each with who proposed
 * it and how to reach them, waiting for the organizers to accept or
 * decline it.
 *
 * - What the talk is: a title, an abstract and a format (a talk, a
 *   lightning talk or a demo).
 * - Who proposes it: a name, an email, a few lines about them and up to
 *   four https links (their site, GitHub, the project the talk is about),
 *   and notes for the organizers alone.
 * - Where it came from (`source`): the site's form, the MCP server, the
 *   CLI, the API, or an organizer recording one sent to them, who is then
 *   named (`recorded_by`, an ALLTHINGS_ACTOR).
 * - Where it stands (`status`): `new`, then `accepted` or `declined`, with
 *   who decided, when, and a note of why.
 *
 * The rows are private: the email and the notes above all. In the planning
 * schema, so neither site role can read or write them
 * (tests/planning-privacy.test.ts); the studio reads them and decides them
 * (infra/scripts/studio.ts), and nothing public ever shows one. No seed,
 * fixture or backfill holds a proposal.
 *
 * The limits here are the ones src/proposals.ts checks first, with a
 * reason a person can read; these hold whatever writes.
 *
 * Anyone may propose, through the site's Worker, which writes as
 * `proposal_intake` (src/proposal-intake.ts): a role made here without a
 * login, which may INSERT the columns a proposal is sent with, as a
 * source other than an organizer (it can't name one), and nothing else.
 * No SELECT, so a statement of its can't read a proposal back, not even
 * its own; no UPDATE or DELETE; no other table. Its login is set by
 * infra/scripts/proposal-intake.ts, as profile_editor's is
 * (migrations/0034_profile_editor.ts), and
 * tests/proposal-intake-role.test.ts holds the catalog to this.
 *
 * And `proposals_intake`, a trigger that runs as the table's owner
 * (SECURITY DEFINER), so it can read what the role can't, before each
 * proposal from outside is kept, one at a time (a lock held to its
 * commit, so two sent at once are checked one after the other):
 *
 * - the same proposal (email, title and abstract) sent again while the
 *   first is still new is dropped, quietly: the sender is told what they
 *   were told the first time, and nothing else;
 * - past 100 proposals from outside in a day, it refuses (SQLSTATE 54000),
 *   so a flood that gets past the edge's rate limit stops here, and the
 *   site says to try again tomorrow.
 *
 * PUBLIC may not execute it, so the studio's tests see no new function.
 */

/** The role the site's Worker sends proposals as; src/proposal-intake.ts states it once more. */
const INTAKE = "proposal_intake";

/** What a proposal is sent with: no status, no decision, no organizer. */
const INTAKE_INSERTS = [
  "title",
  "abstract",
  "format",
  "name",
  "email",
  "about",
  "links",
  "notes",
  "source",
];

/** One short INSERT a request, through Hyperdrive. */
const INTAKE_SETTINGS = {
  statement_timeout: "5s",
  lock_timeout: "2s",
  idle_in_transaction_session_timeout: "5s",
};

/** The most proposals from outside the table takes in a day. */
const DAILY_LIMIT = 100;

/** ALLTHINGS_ACTOR's shape: `erik`, `andre`, `erik/claude-work`. */
const actorRule = (column: string) =>
  `"${column}" ~ '^[a-z0-9][a-z0-9._-]{0,31}(/[a-z0-9][a-z0-9._-]{0,31})?$'`;

/** Not blank, and at most `max` characters. */
const textRule = (column: string, max: number) =>
  `btrim("${column}") <> '' AND char_length("${column}") <= ${max}`;

export const proposals: ReadonlyArray<string> = [
  `CREATE TABLE "planning"."proposals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "title" text NOT NULL,
    "abstract" text NOT NULL,
    "format" text DEFAULT 'talk' NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL,
    "about" text,
    "links" text[] DEFAULT '{}' NOT NULL,
    "notes" text,
    "source" text NOT NULL,
    "recorded_by" text,
    "status" text DEFAULT 'new' NOT NULL,
    "decided_at" timestamp with time zone,
    "decided_by" text,
    "decision_note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "proposals_title_check" CHECK (${textRule("title", 120)} AND strpos("title", chr(10)) = 0),
    CONSTRAINT "proposals_abstract_check" CHECK (${textRule("abstract", 2000)} AND char_length(btrim("abstract")) >= 40),
    CONSTRAINT "proposals_format_check" CHECK ("format" IN ('talk', 'lightning', 'demo')),
    CONSTRAINT "proposals_name_check" CHECK (${textRule("name", 100)} AND strpos("name", chr(10)) = 0),
    CONSTRAINT "proposals_email_check" CHECK (char_length("email") <= 254 AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
    CONSTRAINT "proposals_about_check" CHECK (${textRule("about", 1000)}),
    CONSTRAINT "proposals_links_check" CHECK (cardinality("links") <= 4 AND array_to_string("links", chr(10), '') ~ '^(https://[^[:space:]]{1,247}(\\n|$))*$'),
    CONSTRAINT "proposals_notes_check" CHECK (${textRule("notes", 1000)}),
    CONSTRAINT "proposals_source_check" CHECK ("source" IN ('site', 'mcp', 'cli', 'api', 'organizer')),
    CONSTRAINT "proposals_recorded_by_check" CHECK (${actorRule("recorded_by")}),
    CONSTRAINT "proposals_organizer_check" CHECK (("source" = 'organizer') = ("recorded_by" IS NOT NULL)),
    CONSTRAINT "proposals_status_check" CHECK ("status" IN ('new', 'accepted', 'declined')),
    CONSTRAINT "proposals_decided_check" CHECK (("status" = 'new') = ("decided_at" IS NULL) AND ("decided_at" IS NULL) = ("decided_by" IS NULL) AND ("decision_note" IS NULL OR "decided_at" IS NOT NULL)),
    CONSTRAINT "proposals_decided_by_check" CHECK (${actorRule("decided_by")}),
    CONSTRAINT "proposals_decision_note_check" CHECK (${textRule("decision_note", 1000)})
  )`,
  `CREATE INDEX "proposals_status_created_at_idx" ON "planning"."proposals" USING btree ("status", "created_at")`,
  `CREATE FUNCTION "planning"."proposals_intake"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.source = 'organizer' THEN
    RETURN NEW;
  END IF;
  -- One proposal from outside at a time, to its commit: each check below
  -- then sees every one kept before it, so two sent at once can't both
  -- pass as the first, or both as the 100th.
  PERFORM pg_advisory_xact_lock(hashtext('planning.proposals_intake'));
  IF EXISTS (
    SELECT 1 FROM planning.proposals p
    WHERE p.status = 'new' AND lower(p.email) = lower(NEW.email)
      AND p.title = NEW.title AND p.abstract = NEW.abstract
  ) THEN
    RETURN NULL;
  END IF;
  IF (
    SELECT count(*) FROM planning.proposals p
    WHERE p.source <> 'organizer' AND p.created_at > now() - interval '1 day'
  ) >= ${DAILY_LIMIT} THEN
    RAISE EXCEPTION 'planning.proposals takes at most ${DAILY_LIMIT} proposals a day from outside'
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END
$$`,
  `REVOKE ALL ON FUNCTION "planning"."proposals_intake"() FROM PUBLIC`,
  `CREATE TRIGGER "proposals_intake" BEFORE INSERT ON "planning"."proposals" FOR EACH ROW EXECUTE FUNCTION "planning"."proposals_intake"()`,
  `DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${INTAKE}') THEN
    CREATE ROLE ${INTAKE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;
END
$role$`,
  ...["public", "planning"].flatMap((schema) => [
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${INTAKE}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${INTAKE}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${INTAKE}`,
    `REVOKE ALL ON SCHEMA ${schema} FROM ${INTAKE}`,
  ]),
  `GRANT USAGE ON SCHEMA planning TO ${INTAKE}`,
  `GRANT INSERT (${INTAKE_INSERTS.map((column) => `"${column}"`).join(", ")}) ON "planning"."proposals" TO ${INTAKE}`,
  ...Object.entries(INTAKE_SETTINGS).map(
    ([name, value]) => `ALTER ROLE ${INTAKE} SET ${name} = '${value}'`,
  ),
];

export default statements(proposals);
