import { statements } from "./statements.ts";

/**
 * Collaborating on a draft evening (README, "Collaborating on a draft"):
 * the people an organizer invites to help make one evening, what they see,
 * and what they hand in. All of it is in `planning`, so neither site role
 * can reach it (tests/planning-privacy.test.ts). Ships with the app's
 * drizzle migration 0038_draft_collaboration, which makes the same schema.
 *
 * What the studio writes (as the owner, `bun run collab`):
 *
 * - `collaborators`: who may help with an evening, by the email they sign
 *   in to Cloudflare Access with, the name the others see, and a role:
 *   `viewer`, `commenter`, `round_host` (of one round), `venue` or
 *   `organizer`. A row is active until it is revoked or expires; one active
 *   row per email and evening.
 * - `rounds`: an evening's rounds, for the hosts who write them.
 * - `brief_sections`: the brief, a section at a time, each for the roles
 *   in its `audiences`. Organizers see every section.
 * - `tasks`: what someone has to do, by when: for everyone, for a role, or
 *   for one collaborator.
 * - `logistics_items`: what the venue is asked to confirm.
 * - `reviews`: an organizer's decision on what was handed in.
 *
 * What collaborators hand in, through the draft preview (web/src/preview/),
 * only ever added, never changed:
 *
 * - `round_submissions`: a round host's questions and answer key, each save
 *   a new row, encrypted by the Worker (AES-256-GCM) before it is stored:
 *   `ciphertext` with its `nonce` and the `key_id` it was sealed with.
 * - `logistics_confirmations`: the venue's answer to an item.
 * - `comments`: on the evening, a brief section, or a round (then only its
 *   hosts and the organizers see it). The studio may hide one.
 * - `collab_audit`: every collaborator action, refused ones included.
 *
 * Every table has row security. The owner (the studio) bypasses it; the
 * collaboration role (infra/scripts/draft-collab.ts) does not, and its
 * policies read who is asking from two settings the Worker sets in each
 * transaction from the token Access signed: `collab.email`, and
 * `collab.organizer` ('on' for the stack's organizers). So the database
 * itself, not only the Worker's queries, keeps one evening from another
 * and one host's round from the next.
 *
 * The policies ask the `collab_*` functions, which read `collaborators` as
 * its owner (SECURITY DEFINER, with a fixed search path), so the role reads
 * no collaborator's email unless it organizes that evening, and a policy
 * never reads the table it guards. PUBLIC may execute none of them.
 */

/** Roles every policy may name; `organizer` satisfies any of them. */
const everyone = `ARRAY['viewer', 'commenter', 'round_host', 'venue']::text[]`;
const writers = `ARRAY['commenter', 'round_host', 'venue']::text[]`;
const organizers = `ARRAY['organizer']::text[]`;
const venues = `ARRAY['venue']::text[]`;

const definer = `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp`;
const invoker = `LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp`;

export const draftCollaboration: ReadonlyArray<string> = [
  `CREATE TABLE "planning"."rounds" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "title" text NOT NULL,
    "questions" integer DEFAULT 8 NOT NULL,
    "backups" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "rounds_id_event_id_unique" UNIQUE ("id", "event_id"),
    CONSTRAINT "rounds_event_id_position_unique" UNIQUE ("event_id", "position"),
    CONSTRAINT "rounds_position_check" CHECK ("position" > 0),
    CONSTRAINT "rounds_title_check" CHECK (btrim("title") <> '' AND char_length("title") <= 80),
    CONSTRAINT "rounds_questions_check" CHECK ("questions" BETWEEN 1 AND 20),
    CONSTRAINT "rounds_backups_check" CHECK ("backups" BETWEEN 0 AND 5),
    CONSTRAINT "rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id")
  )`,
  `CREATE TABLE "planning"."collaborators" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "email" text NOT NULL,
    "name" text NOT NULL,
    "role" text NOT NULL,
    "round_id" uuid,
    "invited_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "collaborators_id_event_id_unique" UNIQUE ("id", "event_id"),
    CONSTRAINT "collaborators_email_check" CHECK ("email" = lower("email") AND char_length("email") <= 254 AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
    CONSTRAINT "collaborators_name_check" CHECK (btrim("name") <> '' AND char_length("name") <= 80),
    CONSTRAINT "collaborators_role_check" CHECK ("role" IN ('viewer', 'commenter', 'round_host', 'venue', 'organizer')),
    CONSTRAINT "collaborators_round_check" CHECK (("role" = 'round_host') = ("round_id" IS NOT NULL)),
    CONSTRAINT "collaborators_expires_check" CHECK ("expires_at" > "invited_at"),
    CONSTRAINT "collaborators_revoked_check" CHECK ("revoked_at" >= "invited_at"),
    CONSTRAINT "collaborators_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "collaborators_round_fk" FOREIGN KEY ("round_id", "event_id") REFERENCES "planning"."rounds" ("id", "event_id")
  )`,
  // One active invitation per email and evening; every request looks its
  // signer up by email.
  `CREATE UNIQUE INDEX "collaborators_active_unique" ON "planning"."collaborators" USING btree ("event_id", "email") WHERE "revoked_at" IS NULL`,
  `CREATE INDEX "collaborators_email_idx" ON "planning"."collaborators" USING btree ("email") WHERE "revoked_at" IS NULL`,
  `CREATE TABLE "planning"."brief_sections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "heading" text NOT NULL,
    "body" text NOT NULL,
    "audiences" text[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "brief_sections_id_event_id_unique" UNIQUE ("id", "event_id"),
    CONSTRAINT "brief_sections_event_id_position_unique" UNIQUE ("event_id", "position"),
    CONSTRAINT "brief_sections_position_check" CHECK ("position" > 0),
    CONSTRAINT "brief_sections_heading_check" CHECK (btrim("heading") <> '' AND char_length("heading") <= 120),
    CONSTRAINT "brief_sections_body_check" CHECK (btrim("body") <> '' AND char_length("body") <= 20000),
    CONSTRAINT "brief_sections_audiences_check" CHECK (cardinality("audiences") > 0 AND "audiences" <@ ARRAY['viewer', 'commenter', 'round_host', 'venue', 'organizer']::text[]),
    CONSTRAINT "brief_sections_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id")
  )`,
  `CREATE TABLE "planning"."tasks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "title" text NOT NULL,
    "due_on" date,
    "role" text,
    "collaborator_id" uuid,
    "done_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tasks_title_check" CHECK (btrim("title") <> '' AND char_length("title") <= 200),
    CONSTRAINT "tasks_role_check" CHECK ("role" IN ('viewer', 'commenter', 'round_host', 'venue', 'organizer')),
    CONSTRAINT "tasks_for_check" CHECK (num_nonnulls("role", "collaborator_id") <= 1),
    CONSTRAINT "tasks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "tasks_collaborator_fk" FOREIGN KEY ("collaborator_id", "event_id") REFERENCES "planning"."collaborators" ("id", "event_id")
  )`,
  `CREATE INDEX "tasks_event_id_idx" ON "planning"."tasks" USING btree ("event_id")`,
  `CREATE TABLE "planning"."logistics_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "label" text NOT NULL,
    "detail" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "logistics_items_id_event_id_unique" UNIQUE ("id", "event_id"),
    CONSTRAINT "logistics_items_event_id_position_unique" UNIQUE ("event_id", "position"),
    CONSTRAINT "logistics_items_position_check" CHECK ("position" > 0),
    CONSTRAINT "logistics_items_label_check" CHECK (btrim("label") <> '' AND char_length("label") <= 120),
    CONSTRAINT "logistics_items_detail_check" CHECK (btrim("detail") <> '' AND char_length("detail") <= 1000),
    CONSTRAINT "logistics_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id")
  )`,
  `CREATE TABLE "planning"."logistics_confirmations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "item_id" uuid NOT NULL,
    "collaborator_id" uuid NOT NULL,
    "answer" text NOT NULL,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "logistics_confirmations_answer_check" CHECK ("answer" IN ('yes', 'no', 'unsure')),
    CONSTRAINT "logistics_confirmations_note_check" CHECK (btrim("note") <> '' AND char_length("note") <= 1000),
    CONSTRAINT "logistics_confirmations_item_fk" FOREIGN KEY ("item_id", "event_id") REFERENCES "planning"."logistics_items" ("id", "event_id"),
    CONSTRAINT "logistics_confirmations_collaborator_fk" FOREIGN KEY ("collaborator_id", "event_id") REFERENCES "planning"."collaborators" ("id", "event_id")
  )`,
  `CREATE INDEX "logistics_confirmations_item_id_created_at_idx" ON "planning"."logistics_confirmations" USING btree ("item_id", "created_at")`,
  `CREATE TABLE "planning"."round_submissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "round_id" uuid NOT NULL,
    "collaborator_id" uuid NOT NULL,
    "stage" text NOT NULL,
    "key_id" text NOT NULL,
    "nonce" bytea NOT NULL,
    "ciphertext" bytea NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "round_submissions_stage_check" CHECK ("stage" IN ('draft', 'final')),
    CONSTRAINT "round_submissions_key_id_check" CHECK ("key_id" ~ '^[a-z0-9-]{1,32}$'),
    CONSTRAINT "round_submissions_nonce_check" CHECK (octet_length("nonce") = 12),
    CONSTRAINT "round_submissions_ciphertext_check" CHECK (octet_length("ciphertext") BETWEEN 17 AND 65552),
    CONSTRAINT "round_submissions_round_fk" FOREIGN KEY ("round_id", "event_id") REFERENCES "planning"."rounds" ("id", "event_id"),
    CONSTRAINT "round_submissions_collaborator_fk" FOREIGN KEY ("collaborator_id", "event_id") REFERENCES "planning"."collaborators" ("id", "event_id")
  )`,
  `CREATE INDEX "round_submissions_round_id_created_at_idx" ON "planning"."round_submissions" USING btree ("round_id", "created_at")`,
  `CREATE TABLE "planning"."reviews" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "round_submission_id" uuid,
    "logistics_confirmation_id" uuid,
    "decision" text NOT NULL,
    "note" text,
    "reviewer" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "reviews_subject_check" CHECK (num_nonnulls("round_submission_id", "logistics_confirmation_id") = 1),
    CONSTRAINT "reviews_decision_check" CHECK ("decision" IN ('accepted', 'rejected', 'changes_requested')),
    CONSTRAINT "reviews_note_check" CHECK (btrim("note") <> '' AND char_length("note") <= 2000),
    CONSTRAINT "reviews_reviewer_check" CHECK (btrim("reviewer") <> '' AND char_length("reviewer") <= 80),
    CONSTRAINT "reviews_round_submission_id_round_submissions_id_fk" FOREIGN KEY ("round_submission_id") REFERENCES "planning"."round_submissions" ("id"),
    CONSTRAINT "reviews_logistics_confirmation_id_logistics_confirmations_id_fk" FOREIGN KEY ("logistics_confirmation_id") REFERENCES "planning"."logistics_confirmations" ("id")
  )`,
  `CREATE INDEX "reviews_round_submission_id_idx" ON "planning"."reviews" USING btree ("round_submission_id")`,
  `CREATE INDEX "reviews_logistics_confirmation_id_idx" ON "planning"."reviews" USING btree ("logistics_confirmation_id")`,
  `CREATE TABLE "planning"."comments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "collaborator_id" uuid,
    "author_name" text NOT NULL,
    "author_email" text NOT NULL,
    "section_id" uuid,
    "round_id" uuid,
    "body" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "hidden_at" timestamp with time zone,
    CONSTRAINT "comments_author_name_check" CHECK (btrim("author_name") <> '' AND char_length("author_name") <= 80),
    CONSTRAINT "comments_author_email_check" CHECK ("author_email" = lower("author_email") AND char_length("author_email") <= 254),
    CONSTRAINT "comments_target_check" CHECK (num_nonnulls("section_id", "round_id") <= 1),
    CONSTRAINT "comments_body_check" CHECK (btrim("body") <> '' AND char_length("body") <= 2000),
    CONSTRAINT "comments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id"),
    CONSTRAINT "comments_collaborator_fk" FOREIGN KEY ("collaborator_id", "event_id") REFERENCES "planning"."collaborators" ("id", "event_id"),
    CONSTRAINT "comments_section_fk" FOREIGN KEY ("section_id", "event_id") REFERENCES "planning"."brief_sections" ("id", "event_id"),
    CONSTRAINT "comments_round_fk" FOREIGN KEY ("round_id", "event_id") REFERENCES "planning"."rounds" ("id", "event_id")
  )`,
  `CREATE INDEX "comments_event_id_created_at_idx" ON "planning"."comments" USING btree ("event_id", "created_at")`,
  // Kept even when its evening goes: no foreign key, and a refused request
  // may name an evening that was never there.
  `CREATE TABLE "planning"."collab_audit" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "at" timestamp with time zone DEFAULT now() NOT NULL,
    "actor_email" text NOT NULL,
    "event_id" uuid,
    "action" text NOT NULL,
    "target_id" uuid,
    "outcome" text NOT NULL,
    "request_id" text,
    "detail" text,
    CONSTRAINT "collab_audit_actor_email_check" CHECK ("actor_email" = lower("actor_email") AND char_length("actor_email") <= 254),
    CONSTRAINT "collab_audit_action_check" CHECK (char_length("action") <= 48 AND "action" ~ '^[a-z_]+([.][a-z_]+)*$'),
    CONSTRAINT "collab_audit_outcome_check" CHECK ("outcome" IN ('ok', 'refused', 'invalid', 'limited')),
    CONSTRAINT "collab_audit_request_id_check" CHECK (char_length("request_id") <= 64),
    CONSTRAINT "collab_audit_detail_check" CHECK (char_length("detail") <= 500)
  )`,
  `CREATE INDEX "collab_audit_actor_email_at_idx" ON "planning"."collab_audit" USING btree ("actor_email", "at")`,
  `CREATE INDEX "collab_audit_event_id_at_idx" ON "planning"."collab_audit" USING btree ("event_id", "at")`,

  // Who is asking: the settings the Worker sets in each transaction.
  `CREATE FUNCTION "planning"."collab_email"() RETURNS text ${invoker} AS $$
    SELECT nullif(lower(current_setting('collab.email', true)), '')
  $$`,
  `CREATE FUNCTION "planning"."collab_is_organizer"() RETURNS boolean ${invoker} AS $$
    SELECT coalesce(current_setting('collab.organizer', true), '') = 'on'
      AND planning.collab_email() IS NOT NULL
  $$`,
  // The asker's active invitations, without their email.
  `CREATE FUNCTION "planning"."collab_memberships"()
    RETURNS TABLE ("collaborator_id" uuid, "event_id" uuid, "role" text, "round_id" uuid, "name" text)
    ${definer} AS $$
    SELECT c.id, c.event_id, c.role, c.round_id, c.name
    FROM planning.collaborators c
    WHERE c.email = planning.collab_email()
      AND c.revoked_at IS NULL
      AND c.expires_at > now()
  $$`,
  // Whether the asker holds one of `p_roles` on the evening; organizers,
  // the stack's or the evening's, hold every role.
  `CREATE FUNCTION "planning"."collab_has_role"("p_event" uuid, "p_roles" text[]) RETURNS boolean ${definer} AS $$
    SELECT planning.collab_is_organizer() OR EXISTS (
      SELECT 1 FROM planning.collab_memberships() m
      WHERE m.event_id = p_event
        AND (m.role = 'organizer' OR m.role = ANY (p_roles))
    )
  $$`,
  // Whether the asker hosts the round.
  `CREATE FUNCTION "planning"."collab_hosts"("p_round" uuid) RETURNS boolean ${definer} AS $$
    SELECT EXISTS (
      SELECT 1 FROM planning.collab_memberships() m
      WHERE m.role = 'round_host' AND m.round_id = p_round
    )
  $$`,
  // Who else helps with the evening: names and roles for anyone on it,
  // emails only for its organizers.
  `CREATE FUNCTION "planning"."collab_roster"("p_event" uuid)
    RETURNS TABLE ("collaborator_id" uuid, "name" text, "role" text, "round_id" uuid, "email" text)
    ${definer} AS $$
    SELECT c.id, c.name, c.role, c.round_id,
      CASE WHEN planning.collab_has_role(p_event, ${organizers}) THEN c.email END
    FROM planning.collaborators c
    WHERE c.event_id = p_event
      AND c.revoked_at IS NULL
      AND c.expires_at > now()
      AND planning.collab_has_role(p_event, ${everyone})
    ORDER BY c.role, c.name, c.id
  $$`,
  // How many of `p_actions` the asker took since `p_since`: the rate limit.
  `CREATE FUNCTION "planning"."collab_recent_actions"("p_since" timestamp with time zone, "p_actions" text[]) RETURNS bigint ${definer} AS $$
    SELECT count(*) FROM planning.collab_audit a
    WHERE a.actor_email = planning.collab_email()
      AND a.at >= p_since
      AND a.action = ANY (p_actions)
  $$`,
  ...[
    `"planning"."collab_email"()`,
    `"planning"."collab_is_organizer"()`,
    `"planning"."collab_memberships"()`,
    `"planning"."collab_has_role"(uuid, text[])`,
    `"planning"."collab_hosts"(uuid)`,
    `"planning"."collab_roster"(uuid)`,
    `"planning"."collab_recent_actions"(timestamp with time zone, text[])`,
  ].map((routine) => `REVOKE ALL ON FUNCTION ${routine} FROM PUBLIC`),

  ...[
    "rounds",
    "collaborators",
    "brief_sections",
    "tasks",
    "logistics_items",
    "logistics_confirmations",
    "round_submissions",
    "reviews",
    "comments",
    "collab_audit",
  ].map(
    (table) => `ALTER TABLE "planning"."${table}" ENABLE ROW LEVEL SECURITY`,
  ),

  // collaborators: no policy, so no one but the owner reads it directly.
  `CREATE POLICY "rounds_select" ON "planning"."rounds" FOR SELECT
    USING (planning.collab_has_role("event_id", ${everyone}))`,
  `CREATE POLICY "brief_sections_select" ON "planning"."brief_sections" FOR SELECT
    USING (planning.collab_has_role("event_id", ${organizers}) OR EXISTS (
      SELECT 1 FROM planning.collab_memberships() m
      WHERE m.event_id = "brief_sections"."event_id" AND m.role = ANY ("brief_sections"."audiences")
    ))`,
  `CREATE POLICY "tasks_select" ON "planning"."tasks" FOR SELECT
    USING (planning.collab_has_role("event_id", ${organizers}) OR EXISTS (
      SELECT 1 FROM planning.collab_memberships() m
      WHERE m.event_id = "tasks"."event_id" AND (
        m.collaborator_id = "tasks"."collaborator_id"
        OR m.role = "tasks"."role"
        OR ("tasks"."role" IS NULL AND "tasks"."collaborator_id" IS NULL)
      )
    ))`,
  `CREATE POLICY "logistics_items_select" ON "planning"."logistics_items" FOR SELECT
    USING (planning.collab_has_role("event_id", ${venues}))`,
  `CREATE POLICY "logistics_confirmations_select" ON "planning"."logistics_confirmations" FOR SELECT
    USING (planning.collab_has_role("event_id", ${venues}))`,
  `CREATE POLICY "logistics_confirmations_insert" ON "planning"."logistics_confirmations" FOR INSERT
    WITH CHECK (EXISTS (
      SELECT 1 FROM planning.collab_memberships() m
      WHERE m.collaborator_id = "logistics_confirmations"."collaborator_id"
        AND m.event_id = "logistics_confirmations"."event_id"
        AND m.role IN ('venue', 'organizer')
    ))`,
  `CREATE POLICY "round_submissions_select" ON "planning"."round_submissions" FOR SELECT
    USING (planning.collab_has_role("event_id", ${organizers}) OR planning.collab_hosts("round_id"))`,
  `CREATE POLICY "round_submissions_insert" ON "planning"."round_submissions" FOR INSERT
    WITH CHECK (EXISTS (
      SELECT 1 FROM planning.collab_memberships() m
      WHERE m.collaborator_id = "round_submissions"."collaborator_id"
        AND m.event_id = "round_submissions"."event_id"
        AND m.role = 'round_host'
        AND m.round_id = "round_submissions"."round_id"
    ))`,
  // A review shows to whoever may see what it reviews.
  `CREATE POLICY "reviews_select" ON "planning"."reviews" FOR SELECT
    USING (
      "round_submission_id" IN (SELECT s.id FROM planning.round_submissions s)
      OR "logistics_confirmation_id" IN (SELECT l.id FROM planning.logistics_confirmations l)
    )`,
  `CREATE POLICY "comments_select" ON "planning"."comments" FOR SELECT
    USING ("hidden_at" IS NULL AND (
      planning.collab_has_role("event_id", ${organizers}) OR (
        planning.collab_has_role("event_id", ${everyone})
        AND ("round_id" IS NULL OR planning.collab_hosts("round_id"))
        AND ("section_id" IS NULL OR "section_id" IN (SELECT b.id FROM planning.brief_sections b))
      )
    ))`,
  `CREATE POLICY "comments_insert" ON "planning"."comments" FOR INSERT
    WITH CHECK (
      "hidden_at" IS NULL
      AND "author_email" = planning.collab_email()
      AND planning.collab_has_role("event_id", ${writers})
      AND ("round_id" IS NULL OR planning.collab_has_role("event_id", ${organizers}) OR planning.collab_hosts("round_id"))
      AND ("section_id" IS NULL OR "section_id" IN (SELECT b.id FROM planning.brief_sections b))
      AND (
        ("collaborator_id" IS NULL AND planning.collab_is_organizer())
        OR "collaborator_id" IN (
          SELECT m.collaborator_id FROM planning.collab_memberships() m
          WHERE m.event_id = "comments"."event_id"
        )
      )
    )`,
  // Written as the asker, read by no one but the owner.
  `CREATE POLICY "collab_audit_insert" ON "planning"."collab_audit" FOR INSERT
    WITH CHECK ("actor_email" = planning.collab_email())`,
];

export default statements(draftCollaboration);
