import { statements } from "./statements.ts";

/**
 * Forgetting a draft evening whose private Luma event is gone (README,
 * "Drafts the feed doesn't carry"; `bun run luma:drafts --forget`).
 *
 * `planning.forget_draft(p_event, p_forget)` runs as its owner (SECURITY
 * DEFINER, with a fixed search path), so the studio role
 * (infra/scripts/studio.ts) is given this one function instead of DELETE
 * on `events` and the tables that point at it, which Postgres can't scope
 * to drafts without row security on `events`. It locks the evening, then
 * counts, in one answer:
 *
 * - `blocks`: what keeps it from being forgotten, each with its rows, only
 *   those with any: the evening is published (`public.events.is_draft`),
 *   has a short link or a stored cover image, anything public points at it
 *   (its people, talks, hosts, photos, posts, schedule, notes, short links,
 *   review sessions), it was ever claimed for a publish or posted about,
 *   an idea is its or was inspired by it, or it has a collaboration. Each is
 *   the owner's to settle, never this function's.
 * - `deletes`: what forgetting it deletes, in one statement each: its
 *   private lineup and talks (`draft_people`, `draft_talks`,
 *   `draft_talk_people`) and the evening itself.
 * - `keeps`: what stays, having no foreign key to it: its log and notes
 *   (migrations/0028_draft_log.ts) and the collaboration's audit.
 *
 * With `p_forget` and nothing in `blocks`, it deletes `deletes` and
 * answers `forgotten: true`; otherwise it changes nothing. NULL for an
 * evening that isn't stored. Whether Luma still has the event is asked
 * before, by the caller (src/luma/drafts.ts): the database can't ask Luma.
 *
 * Every foreign key to `events`, or to `draft_talks`, is in `blocks` or
 * `deletes` (tests/luma-drafts.test.ts): one added later fails the test
 * until a migration replaces this function to say which it is, and the
 * delete fails rather than forget past it. PUBLIC may not execute it; the
 * studio's script grants it. Ships with the app's drizzle migration
 * 0042_forget_draft, which makes the same function.
 */

/** A column pointing at the evening: any row with it keeps the evening. */
export const forgetBlocks: ReadonlyArray<
  readonly [table: string, column: string]
> = [
  ["public.event_people", "event_id"],
  ["public.event_talks", "event_id"],
  ["public.event_sponsors", "event_id"],
  ["public.event_images", "event_id"],
  ["public.event_posts", "event_id"],
  ["public.event_schedule_items", "event_id"],
  ["public.event_notes", "event_id"],
  ["public.event_slugs", "event_id"],
  ["public.event_review_sessions", "event_id"],
  ["planning.publishes", "event_id"],
  ["planning.sent_posts", "event_id"],
  ["planning.ideas", "event_id"],
  ["planning.ideas", "inspired_by_event_id"],
  ["planning.rounds", "event_id"],
  ["planning.collaborators", "event_id"],
  ["planning.brief_sections", "event_id"],
  ["planning.tasks", "event_id"],
  ["planning.logistics_items", "event_id"],
  ["planning.logistics_confirmations", "event_id"],
  ["planning.round_submissions", "event_id"],
  ["planning.comments", "event_id"],
];

/** What forgetting deletes, in order: the private lineup, then the evening. */
export const forgetDeletes = [
  "planning.draft_talk_people",
  "planning.draft_talks",
  "planning.draft_people",
  "public.events",
] as const;

/** What stays when the evening goes: no foreign key holds it to it. */
export const forgetKeeps = [
  "planning.collab_audit",
  "planning.draft_log",
  "planning.draft_notes",
] as const;

/** `blocks`' key for a column: the table, or `table.column` for any other column. */
export const blockKey = ([table, column]: readonly [string, string]) =>
  column === "event_id" ? table : `${table}.${column}`;

const counted = (table: string, column = "event_id") =>
  `(SELECT count(*) FROM ${table} t WHERE t.${column} = p_event)`;

const talkPeople = `(SELECT count(*) FROM planning.draft_talk_people p JOIN planning.draft_talks t ON t.id = p.draft_talk_id WHERE t.event_id = p_event)`;

export const forgetDraft = `CREATE FUNCTION "planning"."forget_draft"("p_event" uuid, "p_forget" boolean)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_draft boolean;
  v_short_slug text;
  v_preview_image uuid;
  v_blocks jsonb;
  v_deletes jsonb;
  v_keeps jsonb;
BEGIN
  SELECT e.is_draft, e.short_slug, e.preview_image
    INTO v_draft, v_short_slug, v_preview_image
    FROM public.events e WHERE e.id = p_event FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(jsonb_object_agg(b.what, b.n), '{}'::jsonb) INTO v_blocks
  FROM (VALUES
    ('public.events.is_draft', (CASE WHEN v_draft THEN 0 ELSE 1 END)::bigint),
    ('public.events.short_slug', (CASE WHEN v_short_slug IS NULL THEN 0 ELSE 1 END)::bigint),
    ('public.events.preview_image', (CASE WHEN v_preview_image IS NULL THEN 0 ELSE 1 END)::bigint),
${forgetBlocks.map(([table, column]) => `    ('${blockKey([table, column])}', ${counted(table, column)})`).join(",\n")}
  ) AS b(what, n)
  WHERE b.n > 0;
  v_deletes := jsonb_build_object(
    'planning.draft_talk_people', ${talkPeople},
    'planning.draft_talks', ${counted("planning.draft_talks")},
    'planning.draft_people', ${counted("planning.draft_people")},
    'public.events', 1);
  v_keeps := jsonb_build_object(
${forgetKeeps.map((table) => `    '${table}', ${counted(table)}`).join(",\n")});
  IF NOT p_forget OR v_blocks <> '{}'::jsonb THEN
    RETURN jsonb_build_object('blocks', v_blocks, 'deletes', v_deletes, 'keeps', v_keeps, 'forgotten', false);
  END IF;
  DELETE FROM planning.draft_talk_people p USING planning.draft_talks t
    WHERE t.id = p.draft_talk_id AND t.event_id = p_event;
  DELETE FROM planning.draft_talks t WHERE t.event_id = p_event;
  DELETE FROM planning.draft_people t WHERE t.event_id = p_event;
  DELETE FROM public.events e WHERE e.id = p_event;
  RETURN jsonb_build_object('blocks', v_blocks, 'deletes', v_deletes, 'keeps', v_keeps, 'forgotten', true);
END
$$`;

export const forgetDraftStatements: ReadonlyArray<string> = [
  forgetDraft,
  `REVOKE ALL ON FUNCTION "planning"."forget_draft"(uuid, boolean) FROM PUBLIC`,
];

export default statements(forgetDraftStatements);
