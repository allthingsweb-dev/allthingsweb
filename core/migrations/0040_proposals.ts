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
 */

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
    CONSTRAINT "proposals_abstract_check" CHECK (${textRule("abstract", 2000)}),
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
];

export default statements(proposals);
