import { statements } from "./statements.ts";

/**
 * `public.queue_event_post`: the one way site_sync adds a post about an
 * evening, and only ever as `pending`, for an organizer to approve or hide
 * (src/posts/review.ts). A column grant can't limit a value, so the sync
 * holds no INSERT on event_posts; it holds EXECUTE on this function, which
 * runs as its owner (the role that migrates), with its search path pinned.
 *
 * It takes a found post's fields, never a status, and checks them before
 * writing: a published evening by its slug; an X or Bluesky post by its
 * canonical URL (src/posts/urls.ts: x.com/i/status/<id>, or bsky.app by
 * DID); an author name; https links or none; text; a time no later than a
 * day from now. Anything else is refused with invalid_parameter_value and
 * nothing is written. A post already stored, on any evening and whatever
 * its status, stays as it is. It answers as EventPostWriter.add reads it:
 * the evening's id (null when there is no such published evening), the id
 * added (null when nothing was), and the post already there, if any.
 *
 * Ships with the app's drizzle migration 0030_pending_posts, which runs the
 * same statements. EXECUTE is revoked from PUBLIC; site_sync gets it here
 * where it exists, and from infra/scripts/site-sync.ts whenever its grants
 * are applied.
 */
export const queueEventPost = `CREATE FUNCTION "public"."queue_event_post"(
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
    (platform = 'x' AND url ~ '^https://x\\.com/i/status/[0-9]{1,20}$')
    OR (platform = 'bluesky' AND url ~ '^https://bsky\\.app/profile/did:(plc|web):[A-Za-z0-9._:%-]{1,200}/post/[A-Za-z0-9._~:-]{1,100}$')
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
$$`;

export const pendingPosts: ReadonlyArray<string> = [
  queueEventPost,
  `REVOKE ALL ON FUNCTION "public"."queue_event_post"(text, text, text, text, text, text, text, timestamptz, text, text) FROM PUBLIC`,
  `DO $grant$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'site_sync') THEN
      GRANT EXECUTE ON FUNCTION "public"."queue_event_post"(text, text, text, text, text, text, text, timestamptz, text, text) TO site_sync;
    END IF;
  END
  $grant$`,
];

export default statements(pendingPosts);
