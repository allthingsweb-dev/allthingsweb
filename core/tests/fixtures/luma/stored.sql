-- What production might hold when a sync runs over tests/fixtures/luma/calendar.ics:
-- events Luma already knows, edited on the site since; events Luma no longer
-- lists; an event only the site knows; and the rows hanging off them. Ids are
-- readable: e… events, d… images, a… talks, b… profiles, c… hosts.

INSERT INTO images (id, url, placeholder, alt, width, height, created_at, updated_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'https://media.allthings.dev/covers/sentry.png', 'data:image/png;base64,AA', 'Sentry night', 1200, 630, '2024-06-01T00:00:00Z', '2024-06-01T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000002', 'https://media.allthings.dev/photos/crowd.jpg', 'data:image/png;base64,AB', 'The crowd', 1600, 1067, '2024-08-01T00:00:00Z', '2024-08-01T00:00:00Z');

INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, highlight_on_landing_page, preview_image, recording_url, created_at, updated_at) VALUES
  -- A stranded draft with everything an organizer adds: Luma renames and
  -- reschedules it and publishes it; slug, tagline, limit and the rest stay.
  ('e0000000-0000-4000-8000-000000000001', 'sentry-summer-2024', 'Old Sentry title', 'Our own words about the evening', '2024-07-30T01:00:00Z', '2024-07-30T04:00:00Z', 150, '45 Fremont St', 'Sentry HQ', 'Sentry HQ, 45 Fremont St, San Francisco', 'evt-pastSentry24', true, true, true, 'd0000000-0000-4000-8000-000000000001', 'https://www.youtube.com/watch?v=abc123', '2024-06-01T00:00:00Z', '2024-06-01T00:00:00Z'),
  -- Luma shows a different venue now: Luma's wins.
  ('e0000000-0000-4000-8000-000000000002', '2026-11-12-all-things-web-at-vercel-evt-vercelNov26', 'All Things Web at Vercel', 'Edited tagline', '2026-11-13T01:30:00Z', '2026-11-13T05:00:00Z', 200, 'Old address', 'Old venue', 'Old venue, Old address', 'evt-vercelNov26', false, false, false, NULL, NULL, '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z'),
  -- Overwritten by the first public-feed sync with Luma's placeholder; one
  -- field edited by hand since. The archive restores the other two.
  ('e0000000-0000-4000-8000-000000000003', '2026-06-25-react-server-components-at-meraki-evt-HtDmTqndK1vA1Z4', 'React Server Components at Meraki', 'RSC', '2026-06-26T01:00:00Z', '2026-06-26T04:00:00Z', 90, 'https://luma.com/event/evt-HtDmTqndK1vA1Z4', 'Edited venue label', 'https://lu.ma/event/evt-HtDmTqndK1vA1Z4', 'evt-HtDmTqndK1vA1Z4', false, false, false, NULL, NULL, '2026-06-01T00:00:00Z', '2026-09-16T00:00:00Z'),
  -- Luma hides the venue now; the stored one is useful and stays.
  ('e0000000-0000-4000-8000-000000000004', 'secret-venue-night', 'Secret venue night', 'Shh', '2026-12-03T02:00:00Z', '2026-12-03T05:00:00Z', 60, '201 Spear St', 'CodeRabbit', 'CodeRabbit, 201 Spear St, San Francisco', 'evt-hiddenVenue', false, false, false, NULL, NULL, '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z'),
  -- Luma shows no venue; an organizer typed one in. It stays.
  ('e0000000-0000-4000-8000-000000000005', 'venue-tba', 'Venue TBA', 'Soon', '2026-10-15T01:30:00Z', '2026-10-15T04:30:00Z', 80, NULL, 'Somewhere nice', NULL, 'evt-noVenue', false, false, false, NULL, NULL, '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z'),
  -- A placeholder the archive does not know, and Luma shows no venue: cleared.
  ('e0000000-0000-4000-8000-000000000006', 'blank-venue', 'Blank venue', 'Blank', '2026-10-16T01:30:00Z', '2026-10-16T04:30:00Z', 80, 'https://lu.ma/event/evt-blankVenue', 'https://lu.ma/event/evt-blankVenue', 'https://lu.ma/event/evt-blankVenue', 'evt-blankVenue', false, false, false, NULL, NULL, '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z'),
  -- Published, then cancelled on Luma: it becomes a draft, nothing is deleted.
  ('e0000000-0000-4000-8000-000000000007', 'cancelled-meetup', 'Cancelled meetup', 'Was on', '2026-10-22T01:30:00Z', '2026-10-22T04:30:00Z', 100, '201 Spear St', 'CodeRabbit', 'CodeRabbit, 201 Spear St, San Francisco', 'evt-cancelled', false, false, true, NULL, 'https://www.youtube.com/watch?v=kept', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z'),
  -- Gone from Luma's feed: untouched.
  ('e0000000-0000-4000-8000-000000000008', 'gone-from-luma', 'Gone from Luma', 'Still ours', '2023-05-01T01:00:00Z', '2023-05-01T04:00:00Z', 40, NULL, NULL, NULL, 'evt-goneFromFeed', false, false, false, NULL, NULL, '2023-04-01T00:00:00Z', '2023-04-01T00:00:00Z'),
  -- Only the site knows it: untouched.
  ('e0000000-0000-4000-8000-000000000009', 'website-only', 'Website only', 'Ours alone', '2026-10-30T01:00:00Z', '2026-10-30T04:00:00Z', 30, '1 Post St', 'Somewhere', '1 Post St, San Francisco', NULL, true, false, false, NULL, NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO talks (id, title, description, created_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Server components', '<p>Why.</p>', '2024-06-02T00:00:00Z', '2024-06-02T00:00:00Z');
INSERT INTO profiles (id, name, title, bio, profile_type, created_at, updated_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Ada Lovelace', 'Engineer', 'Writes compilers.', 'member', '2024-06-02T00:00:00Z', '2024-06-02T00:00:00Z');
INSERT INTO talk_speakers (talk_id, speaker_id, created_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '2024-06-02T00:00:00Z', '2024-06-02T00:00:00Z');
INSERT INTO sponsors (id, name, about, created_at, updated_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Sentry', 'Application monitoring.', '2024-06-02T00:00:00Z', '2024-06-02T00:00:00Z');
INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '2024-06-03T00:00:00Z', '2024-06-03T00:00:00Z');
INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '2024-06-03T00:00:00Z', '2024-06-03T00:00:00Z');
INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', '2024-08-01T00:00:00Z', '2024-08-01T00:00:00Z');
INSERT INTO event_review_sessions (id, event_id, channel_id, root_message_id, thread_id, status, created_at, updated_at) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000007', 'channel', 'root', 'thread', 'pending', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z');
