-- site_sync queues found posts as pending through this function only; core/migrations/0018_pending_posts.ts is the same change (not modelled by drizzle).
CREATE FUNCTION "public"."queue_event_post"(
  event_slug text,
  platform text,
  url text,
  author_name text,
  author_handle text,
  author_url text,
  author_avatar_source_url text,
  posted_at timestamptz,
  post_text text,
  image_source_url text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  event_id uuid;
  added_id uuid;
  existing json;
BEGIN
  IF platform IS NULL OR platform NOT IN ('x', 'bluesky') THEN
    RAISE EXCEPTION 'a queued post is on X or Bluesky, not %', coalesce(platform, 'nothing')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF url IS NULL OR NOT (
    (platform = 'x' AND url ~ '^https://x\.com/i/status/[0-9]{1,20}$')
    OR (platform = 'bluesky' AND url ~ '^https://bsky\.app/profile/did:(plc|web):[A-Za-z0-9._:%-]{1,200}/post/[A-Za-z0-9._~:-]{1,100}$')
  ) THEN
    RAISE EXCEPTION 'not a canonical % post URL: %', platform, coalesce(url, 'nothing')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF author_name IS NULL OR btrim(author_name) = '' OR length(author_name) > 200 THEN
    RAISE EXCEPTION 'a queued post needs its author''s name, at most 200 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF author_handle IS NOT NULL AND (btrim(author_handle) = '' OR length(author_handle) > 253) THEN
    RAISE EXCEPTION 'an author handle is a name of at most 253 characters, or none'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (author_url IS NOT NULL AND (author_url !~ '^https://[^[:space:]]+$' OR length(author_url) > 2000))
    OR (author_avatar_source_url IS NOT NULL AND (author_avatar_source_url !~ '^https://[^[:space:]]+$' OR length(author_avatar_source_url) > 2000))
    OR (image_source_url IS NOT NULL AND (image_source_url !~ '^https://[^[:space:]]+$' OR length(image_source_url) > 2000)) THEN
    RAISE EXCEPTION 'a queued post''s links are https URLs, or none'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF post_text IS NULL OR length(post_text) > 10000 THEN
    RAISE EXCEPTION 'a queued post has its text, at most 10000 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF posted_at IS NULL OR posted_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'a queued post was posted at a time, and not in the future'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT e.id INTO event_id FROM public.events e
    WHERE e.slug = event_slug AND e.is_draft = false;
  SELECT json_build_object('id', p.id, 'url', p.url, 'eventSlug', e.slug, 'status', p.status)
    INTO existing
    FROM public.event_posts p JOIN public.events e ON e.id = p.event_id
    WHERE p.url = queue_event_post.url;
  IF event_id IS NOT NULL AND existing IS NULL THEN
    INSERT INTO public.event_posts (event_id, platform, url, author_name,
      author_handle, author_url, author_avatar_source_url, posted_at, text,
      image_source_url, status, updated_at)
    VALUES (event_id, platform, url, author_name, author_handle, author_url,
      author_avatar_source_url, posted_at, post_text, image_source_url,
      'pending', now())
    ON CONFLICT ON CONSTRAINT event_posts_url_unique DO NOTHING
    RETURNING id INTO added_id;
  END IF;
  RETURN json_build_object('eventId', event_id, 'addedId', added_id, 'existing', existing);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."queue_event_post"(text, text, text, text, text, text, text, timestamptz, text, text) FROM PUBLIC;--> statement-breakpoint
DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_sync') THEN
      GRANT EXECUTE ON FUNCTION "public"."queue_event_post"(text, text, text, text, text, text, text, timestamptz, text, text) TO site_sync;
    END IF;
  END
  $grant$;
