import { statements } from "./statements.ts";
import { blockKey, forgetBlocks, forgetKeeps } from "./0030_forget_draft.ts";

/**
 * A draft's stored cover no longer keeps it from being forgotten
 * (migrations/0030_forget_draft.ts). The image ingestion stores the Luma
 * cover of every evening with a Luma event, drafts included
 * (src/ingest/ingest.ts), so nearly every draft has a `preview_image`, and
 * 0030 refused them all. It is the evening's own copy of its cover, shown
 * nowhere while the evening is a draft, as `luma cover` treats it when it
 * lets it go.
 *
 * `planning.forget_draft` is replaced, with the same signature and
 * answer: `preview_image` leaves `blocks`, and `deletes` gains
 * `public.images`, its row, deleted with the evening unless anything else
 * points at it (`coverReferences`, every other column that may point at an
 * image: tests/luma-drafts.test.ts holds it to src/photos.ts's
 * imageReferences, which tests/photos.test.ts holds to the catalog). The
 * image row is locked before it is counted, so nothing new points at it
 * before the delete. Its object in the bucket stays, as a replaced photo's
 * does. Everything else is 0030's. CREATE OR REPLACE keeps its grants:
 * PUBLIC may still not execute it, and the studio still may. Ships with
 * the app's drizzle migration 0043_forget_draft_cover, which makes the
 * same change.
 */

/** Every column, but this evening's own, that may point at its cover's image row. */
export const coverReferences: ReadonlyArray<
  readonly [table: string, column: string]
> = [
  ["public.event_images", "image_id"],
  ["public.event_posts", "author_avatar"],
  ["public.event_posts", "image"],
  ["public.events", "preview_image"],
  ["public.profiles", "image"],
  ["public.sponsors", "square_logo_dark"],
  ["public.sponsors", "square_logo_light"],
];

/** What forgetting deletes, in order: the private lineup, the evening, then its cover's row. */
export const forgetDeletes = [
  "planning.draft_talk_people",
  "planning.draft_talks",
  "planning.draft_people",
  "public.events",
  "public.images",
] as const;

export { blockKey, forgetBlocks, forgetKeeps };

const counted = (table: string, column = "event_id") =>
  `(SELECT count(*) FROM ${table} t WHERE t.${column} = p_event)`;

const talkPeople = `(SELECT count(*) FROM planning.draft_talk_people p JOIN planning.draft_talks t ON t.id = p.draft_talk_id WHERE t.event_id = p_event)`;

/** Whether anything but this evening points at its cover's image. */
const coverShared = coverReferences
  .map(
    ([table, column]) =>
      `EXISTS (SELECT 1 FROM ${table} t WHERE t.${column} = v_preview_image${table === "public.events" ? " AND t.id <> p_event" : ""})`,
  )
  .join("\n      OR ");

export const forgetDraftCover = `CREATE OR REPLACE FUNCTION "planning"."forget_draft"("p_event" uuid, "p_forget" boolean)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_draft boolean;
  v_short_slug text;
  v_preview_image uuid;
  v_cover boolean := false;
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
  IF v_preview_image IS NOT NULL THEN
    PERFORM 1 FROM public.images i WHERE i.id = v_preview_image FOR UPDATE;
    v_cover := NOT (${coverShared});
  END IF;
  SELECT coalesce(jsonb_object_agg(b.what, b.n), '{}'::jsonb) INTO v_blocks
  FROM (VALUES
    ('public.events.is_draft', (CASE WHEN v_draft THEN 0 ELSE 1 END)::bigint),
    ('public.events.short_slug', (CASE WHEN v_short_slug IS NULL THEN 0 ELSE 1 END)::bigint),
${forgetBlocks.map(([table, column]) => `    ('${blockKey([table, column])}', ${counted(table, column)})`).join(",\n")}
  ) AS b(what, n)
  WHERE b.n > 0;
  v_deletes := jsonb_build_object(
    'planning.draft_talk_people', ${talkPeople},
    'planning.draft_talks', ${counted("planning.draft_talks")},
    'planning.draft_people', ${counted("planning.draft_people")},
    'public.events', 1,
    'public.images', (CASE WHEN v_cover THEN 1 ELSE 0 END));
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
  IF v_cover THEN
    DELETE FROM public.images i WHERE i.id = v_preview_image;
  END IF;
  RETURN jsonb_build_object('blocks', v_blocks, 'deletes', v_deletes, 'keeps', v_keeps, 'forgotten', true);
END
$$`;

export const forgetDraftCoverStatements: ReadonlyArray<string> = [
  forgetDraftCover,
  `REVOKE ALL ON FUNCTION "planning"."forget_draft"(uuid, boolean) FROM PUBLIC`,
];

export default statements(forgetDraftCoverStatements);
