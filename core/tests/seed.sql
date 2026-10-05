-- A small catalog for the repository, mapper and parity tests, read as of
-- 2026-10-03T19:00:00Z (tests/support/database.ts). Ids are readable on
-- purpose: e… events, a… talks, b… profiles, c… hosts, d… images.
--
-- Join rows carry explicit created_at values in attach order, and several are
-- attached in the reverse of their ids, so ordering by id would be caught.

INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'https://storage.example/covers/react.png', 'data:image/png;base64,AA', 'React at Acme', 1200, 630, now()),
  ('d0000000-0000-4000-8000-000000000002', 'https://storage.example/logos/acme.png', 'data:image/png;base64,AB', 'Acme', 512, 512, now()),
  ('d0000000-0000-4000-8000-000000000003', 'https://storage.example/photos/crowd.jpg', 'data:image/png;base64,AC', 'The crowd', 1600, 1067, now()),
  ('d0000000-0000-4000-8000-000000000004', 'https://storage.example/photos/stage.jpg', 'data:image/png;base64,AD', 'The stage', 1600, 900, now()),
  ('d0000000-0000-4000-8000-000000000005', 'https://storage.example/people/ada.jpg', 'data:image/png;base64,AE', 'Ada Lovelace', 400, 400, now());

INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, preview_image, recording_url, updated_at) VALUES
  -- Past, with everything: venue, Luma page, recording, hosts, photos.
  ('e0000000-0000-4000-8000-000000000001', '2026-08-12-react-at-acme', 'React at Acme', 'Server components in practice', '2026-08-13T01:00:00Z', '2026-08-13T04:00:00Z', 120, '1 Market St', 'Acme HQ', '1 Market St, San Francisco, CA 94105', 'evt-react', false, false, 'd0000000-0000-4000-8000-000000000001', 'https://www.youtube.com/watch?v=abc123', now()),
  -- A draft: never listed, never found, its speaker never in the directory.
  ('e0000000-0000-4000-8000-000000000002', '2026-09-01-draft-night', 'Draft night', 'Not announced', '2026-09-02T01:00:00Z', '2026-09-02T04:00:00Z', 50, NULL, 'Secret', NULL, 'evt-draft', false, true, NULL, NULL, now()),
  -- Live at the test clock, a hackathon, without a venue or Luma page.
  ('e0000000-0000-4000-8000-000000000003', '2026-10-03-hack-day', 'Hack day', 'Build something', '2026-10-03T16:00:00Z', '2026-10-04T01:00:00Z', 80, NULL, NULL, NULL, NULL, true, false, NULL, NULL, now()),
  -- Upcoming, with a venue name but no address, and a Luma id that needs encoding.
  ('e0000000-0000-4000-8000-000000000004', '2026-11-05-upcoming', 'Upcoming meetup', 'Soon', '2026-11-06T02:00:00Z', '2026-11-06T05:00:00Z', 100, NULL, 'TBA', NULL, 'evt with space', false, false, NULL, NULL, now()),
  -- Ends exactly at the test clock: still live, and already in the directory.
  ('e0000000-0000-4000-8000-000000000005', '2026-10-03-ends-now', 'Ends now', 'Just finished', '2026-10-03T15:00:00Z', '2026-10-03T19:00:00Z', 30, NULL, 'Park', 'Golden Gate Park', NULL, false, false, NULL, 'not a url', now()),
  -- Past, with a slug that needs encoding, an address but no venue name, and a
  -- recording URL that must not be published.
  ('e0000000-0000-4000-8000-000000000006', '2025-12-02-café-night', 'Café night', 'Coffee and code', '2025-12-03T02:00:00Z', '2025-12-03T05:00:00Z', 40, NULL, NULL, '500 Coffee Ave, Oakland, CA', NULL, false, false, NULL, 'javascript:alert(1)', now());

-- Luma counted React at Acme's guests; no other event has counts.
UPDATE events SET luma_guest_count = 118, luma_checked_in_count = 97
  WHERE id = 'e0000000-0000-4000-8000-000000000001';

INSERT INTO profiles (id, name, title, image, twitter_handle, bluesky_handle, linkedin_handle, bio, profile_type, updated_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Ada Lovelace', 'Engineer', 'd0000000-0000-4000-8000-000000000005', 'ada', 'ada.bsky.social', 'ada-lovelace', 'Writes compilers.', 'member', now()),
  ('b0000000-0000-4000-8000-000000000002', 'Grace Hopper', 'Admiral', NULL, NULL, NULL, 'grace hopper', '', 'organizer', now()),
  ('b0000000-0000-4000-8000-000000000003', 'Linus', '', NULL, '@linus', NULL, NULL, 'Kernel.', 'member', now()),
  ('b0000000-0000-4000-8000-000000000004', 'Draft Only', 'Ghost', NULL, NULL, NULL, NULL, 'Hidden.', 'member', now()),
  ('b0000000-0000-4000-8000-000000000005', 'Future Speaker', 'Soon', NULL, 'future', NULL, NULL, 'Next month.', 'member', now()),
  ('b0000000-0000-4000-8000-000000000006', 'Zed Nobody', '', NULL, NULL, NULL, NULL, '', 'member', now()),
  ('b0000000-0000-4000-8000-000000000007', 'Unattached', 'Lurker', NULL, NULL, NULL, NULL, 'No talks yet.', 'member', now());

INSERT INTO talks (id, title, description, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Server components', '<p>Why <strong>RSC</strong> &amp; streaming matter.</p><ul><li>One</li><li>Two</li></ul>', now()),
  ('a0000000-0000-4000-8000-000000000002', 'Effect in production', '<p>Typed errors<br>and services.</p><script>alert(1)</script><img src="x" onerror="alert(1)">', now()),
  ('a0000000-0000-4000-8000-000000000003', 'Secret talk', '<p>Unannounced.</p>', now()),
  ('a0000000-0000-4000-8000-000000000004', 'Hacking live', '', now()),
  ('a0000000-0000-4000-8000-000000000005', 'Next month', '<p>Coming up.</p>', now()),
  ('a0000000-0000-4000-8000-000000000006', 'Lightning talk', 'Plain text, no markup.', now()),
  ('a0000000-0000-4000-8000-000000000007', 'Coffee & code', '<p>Caf&eacute; &lt;3&nbsp;web</p><p></p><p></p><p></p><blockquote>Quote</blockquote><p>End</p>', now());

-- Server components has two speakers, attached Grace first.
INSERT INTO talk_speakers (talk_id, speaker_id, created_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', '2026-01-01T00:00:01Z', now()),
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '2026-01-01T00:00:02Z', now()),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', '2026-01-01T00:00:03Z', now()),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004', '2026-01-01T00:00:04Z', now()),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', '2026-01-01T00:00:05Z', now()),
  ('a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000005', '2026-01-01T00:00:06Z', now()),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000006', '2026-01-01T00:00:07Z', now()),
  ('a0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000003', '2026-01-01T00:00:08Z', now());

-- React at Acme lists Effect before Server components; Server components was
-- also given at Café night.
INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '2026-01-02T00:00:01Z', now()),
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '2026-01-02T00:00:02Z', now()),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', '2026-01-02T00:00:03Z', now()),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', '2026-01-02T00:00:04Z', now()),
  ('e0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005', '2026-01-02T00:00:05Z', now()),
  ('e0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000006', '2026-01-02T00:00:06Z', now()),
  ('e0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000007', '2026-01-02T00:00:07Z', now()),
  ('e0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', '2026-01-02T00:00:08Z', now());

-- Acme has only a light logo, Globex none; Globex was attached first.
INSERT INTO sponsors (id, name, about, square_logo_dark, square_logo_light, updated_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Acme', 'Space and pizza.', NULL, 'd0000000-0000-4000-8000-000000000002', now()),
  ('c0000000-0000-4000-8000-000000000002', 'Globex', 'Drinks.', NULL, NULL, now());

-- Acme's site and X handle are on record; Globex has no links.
UPDATE sponsors SET website_url = 'https://acme.example', twitter_handle = 'acme'
  WHERE id = 'c0000000-0000-4000-8000-000000000001';

INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', '2026-01-03T00:00:01Z', now()),
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '2026-01-03T00:00:02Z', now());

INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', '2026-01-04T00:00:01Z', now()),
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', '2026-01-04T00:00:02Z', now());

INSERT INTO redirects (slug, destination_url, comment, updated_at) VALUES
  ('discord', 'https://discord.gg/B3Sm4b5mfD', 'Community chat', now()),
  ('Luma', 'https://luma.com/allthingsweb', NULL, now());

-- Posts about React at Acme: an approved one whose photo was copied into the
-- bucket, an approved one without images, a hidden one and a pending one;
-- only the approved ones show.
INSERT INTO event_posts (id, event_id, platform, url, author_name, author_handle, author_url, author_avatar_source_url, author_avatar, posted_at, text, image_source_url, image, status, added_at, updated_at) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/i/status/1900000000000000001', 'Ada Lovelace', 'ada', 'https://x.com/ada', 'https://pbs.twimg.com/profile_images/1/ada.jpg', 'd0000000-0000-4000-8000-000000000005', '2026-08-13T02:30:00Z', 'Server components, live at Acme.', 'https://pbs.twimg.com/media/stage.jpg', 'd0000000-0000-4000-8000-000000000004', 'approved', '2026-08-14T00:00:01Z', now()),
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'bluesky', 'https://bsky.app/profile/did:plc:grace/post/3abc', 'Grace Hopper', 'grace.example', 'https://bsky.app/profile/grace.example', NULL, NULL, '2026-08-13T05:00:00Z', E'Thanks, Acme!\nSee you next month.', NULL, NULL, 'approved', '2026-08-14T00:00:02Z', now()),
  ('f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/i/status/1900000000000000003', 'Taken Down', 'gone', 'https://x.com/gone', NULL, NULL, '2026-08-13T03:00:00Z', 'Hidden by an organizer.', NULL, NULL, 'hidden', '2026-08-14T00:00:03Z', now()),
  ('f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'linkedin', 'https://www.linkedin.com/feed/update/urn:li:activity:7360000000000000000/', 'Awaiting Review', NULL, NULL, NULL, NULL, '2026-08-13T04:00:00Z', 'Found by a search; not approved yet.', NULL, NULL, 'pending', '2026-08-14T00:00:04Z', now());
