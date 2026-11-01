-- planning.forget_draft() deletes a draft's stored cover with it instead of refusing it; core/migrations/0031_forget_draft_cover.ts is the same change. drizzle can't declare the function, so it is written here by hand.
CREATE OR REPLACE FUNCTION "planning"."forget_draft"("p_event" uuid, "p_forget" boolean)
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
    v_cover := NOT (EXISTS (SELECT 1 FROM public.event_images t WHERE t.image_id = v_preview_image)
      OR EXISTS (SELECT 1 FROM public.event_posts t WHERE t.author_avatar = v_preview_image)
      OR EXISTS (SELECT 1 FROM public.event_posts t WHERE t.image = v_preview_image)
      OR EXISTS (SELECT 1 FROM public.events t WHERE t.preview_image = v_preview_image AND t.id <> p_event)
      OR EXISTS (SELECT 1 FROM public.profiles t WHERE t.image = v_preview_image)
      OR EXISTS (SELECT 1 FROM public.sponsors t WHERE t.square_logo_dark = v_preview_image)
      OR EXISTS (SELECT 1 FROM public.sponsors t WHERE t.square_logo_light = v_preview_image));
  END IF;
  SELECT coalesce(jsonb_object_agg(b.what, b.n), '{}'::jsonb) INTO v_blocks
  FROM (VALUES
    ('public.events.is_draft', (CASE WHEN v_draft THEN 0 ELSE 1 END)::bigint),
    ('public.events.short_slug', (CASE WHEN v_short_slug IS NULL THEN 0 ELSE 1 END)::bigint),
    ('public.event_people', (SELECT count(*) FROM public.event_people t WHERE t.event_id = p_event)),
    ('public.event_talks', (SELECT count(*) FROM public.event_talks t WHERE t.event_id = p_event)),
    ('public.event_sponsors', (SELECT count(*) FROM public.event_sponsors t WHERE t.event_id = p_event)),
    ('public.event_images', (SELECT count(*) FROM public.event_images t WHERE t.event_id = p_event)),
    ('public.event_posts', (SELECT count(*) FROM public.event_posts t WHERE t.event_id = p_event)),
    ('public.event_schedule_items', (SELECT count(*) FROM public.event_schedule_items t WHERE t.event_id = p_event)),
    ('public.event_notes', (SELECT count(*) FROM public.event_notes t WHERE t.event_id = p_event)),
    ('public.event_slugs', (SELECT count(*) FROM public.event_slugs t WHERE t.event_id = p_event)),
    ('public.event_review_sessions', (SELECT count(*) FROM public.event_review_sessions t WHERE t.event_id = p_event)),
    ('planning.publishes', (SELECT count(*) FROM planning.publishes t WHERE t.event_id = p_event)),
    ('planning.sent_posts', (SELECT count(*) FROM planning.sent_posts t WHERE t.event_id = p_event)),
    ('planning.ideas', (SELECT count(*) FROM planning.ideas t WHERE t.event_id = p_event)),
    ('planning.ideas.inspired_by_event_id', (SELECT count(*) FROM planning.ideas t WHERE t.inspired_by_event_id = p_event)),
    ('planning.rounds', (SELECT count(*) FROM planning.rounds t WHERE t.event_id = p_event)),
    ('planning.collaborators', (SELECT count(*) FROM planning.collaborators t WHERE t.event_id = p_event)),
    ('planning.brief_sections', (SELECT count(*) FROM planning.brief_sections t WHERE t.event_id = p_event)),
    ('planning.tasks', (SELECT count(*) FROM planning.tasks t WHERE t.event_id = p_event)),
    ('planning.logistics_items', (SELECT count(*) FROM planning.logistics_items t WHERE t.event_id = p_event)),
    ('planning.logistics_confirmations', (SELECT count(*) FROM planning.logistics_confirmations t WHERE t.event_id = p_event)),
    ('planning.round_submissions', (SELECT count(*) FROM planning.round_submissions t WHERE t.event_id = p_event)),
    ('planning.comments', (SELECT count(*) FROM planning.comments t WHERE t.event_id = p_event))
  ) AS b(what, n)
  WHERE b.n > 0;
  v_deletes := jsonb_build_object(
    'planning.draft_talk_people', (SELECT count(*) FROM planning.draft_talk_people p JOIN planning.draft_talks t ON t.id = p.draft_talk_id WHERE t.event_id = p_event),
    'planning.draft_talks', (SELECT count(*) FROM planning.draft_talks t WHERE t.event_id = p_event),
    'planning.draft_people', (SELECT count(*) FROM planning.draft_people t WHERE t.event_id = p_event),
    'public.events', 1,
    'public.images', (CASE WHEN v_cover THEN 1 ELSE 0 END));
  v_keeps := jsonb_build_object(
    'planning.collab_audit', (SELECT count(*) FROM planning.collab_audit t WHERE t.event_id = p_event),
    'planning.draft_log', (SELECT count(*) FROM planning.draft_log t WHERE t.event_id = p_event),
    'planning.draft_notes', (SELECT count(*) FROM planning.draft_notes t WHERE t.event_id = p_event));
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "planning"."forget_draft"(uuid, boolean) FROM PUBLIC;
