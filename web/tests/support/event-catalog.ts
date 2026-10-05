import type { PGlite } from "@electric-sql/pglite";
import { migratedDatabase } from "allthings-core/tests/support/database.ts";
import { hosts } from "../../src/links.ts";
import { hostProfiles } from "./catalog.ts";

/**
 * Evenings for the event page, written relative to the moment the tests
 * start, since the Worker reads the wall clock in workerd. Each upcoming
 * one starts at a fixed time of day in UTC, so its mode never depends on
 * when the tests run: 01:30 UTC is an evening in San Francisco (5:30 or
 * 6:30 PM the day before), 18:00 UTC a morning (10 or 11 AM). Ids are
 * readable: e… events, a… talks, b… profiles, c… hosts, d… images.
 */

export const eventPhoto = (name: string) =>
  `https://media.allthings.dev/events/page/${name}.jpg`;

export const speakerPortrait = "https://media.allthings.dev/profiles/ada.jpg";

/** The slugs the tests read, by what each evening is for. */
export const slugs = {
  /** Upcoming, in the evening, with everything a page can show. */
  upcoming: "2099-effect-evening",
  /** Live: started an hour ago, ends in two. */
  live: "live-now",
  /** Past, with photos, a recording and a talk two people gave. */
  past: "2025-01-28-all-things-web-at-sanity",
  /** A past daytime hackathon, without talks, photos or a recording. */
  hackathon: "2025-04-26-hackathon-at-sentry",
  /** Upcoming, in the morning, without a venue or a Luma page. */
  bare: "2099-morning-without-a-venue",
  /** A draft: never shown. */
  draft: "draft-evening",
} as const;

/** The upcoming evening's Luma page. */
export const lumaPage = "https://lu.ma/event/evt-effect";

/** Stored redirects, as /r/<slug> answers them. */
export const redirects = {
  discord: "https://discord.gg/B3Sm4b5mfD",
  /** Not an http(s) URL: never followed. */
  unsafe: "javascript:alert(1)",
} as const;

/** `from` moved by `days`, at `utc` ("01:30") on that day in UTC. */
function dayAt(from: Date, days: number, utc: string): Date {
  const day = new Date(from.getTime() + days * 86_400_000);
  return new Date(`${day.toISOString().slice(0, 10)}T${utc}:00Z`);
}

const iso = (date: Date) => `'${date.toISOString()}'`;

/** The SQL of the catalog as of `now`. */
export function eventCatalog(now: Date): string {
  const upcomingStart = dayAt(now, 8, "01:30");
  const bareStart = dayAt(now, 9, "18:00");
  const liveStart = new Date(now.getTime() - 3_600_000);
  const hours = (start: Date, count: number) =>
    new Date(start.getTime() + count * 3_600_000);
  return `
    INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
      ('d0000000-0000-4000-8000-000000000501', '${eventPhoto("crowd")}', '', 'The crowd at Sanity', 1600, 1200, now()),
      ('d0000000-0000-4000-8000-000000000502', '${eventPhoto("stage")}', '', 'Ada on stage', 1200, 1600, now()),
      ('d0000000-0000-4000-8000-000000000503', 'https://elsewhere.example/photo.jpg', '', 'Not on the media origin', 800, 600, now()),
      ('d0000000-0000-4000-8000-000000000504', '${speakerPortrait}', '', 'Ada Lovelace', 400, 400, now());
    INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, recording_url, topic, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000501', '${slugs.upcoming}', 'Effect San Francisco 🇺🇸', 'All Things Effect, with its creator', ${iso(upcomingStart)}, ${iso(hours(upcomingStart, 3))}, 200, 'CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA', 'CodeRabbit', 'CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA', 'evt-effect', false, false, NULL, NULL, '2026-09-01T12:00:00Z'),
      ('e0000000-0000-4000-8000-000000000502', '${slugs.live}', 'All Things Live', 'Right now', ${iso(liveStart)}, ${iso(hours(liveStart, 3))}, 0, NULL, 'Convex HQ', '444 De Haro St #218, San Francisco, CA 94107, USA', 'evt-live', false, false, NULL, NULL, now()),
      ('e0000000-0000-4000-8000-000000000503', '${slugs.past}', 'All Things Web at Sanity', 'React and content', '2025-01-29T01:00:00Z', '2025-01-29T04:00:00Z', 150, '351 California St, San Francisco, CA 94104, USA', '351 California St', '351 California St, San Francisco, CA 94104, USA', 'evt-sanity', false, false, 'https://youtu.be/sanity', NULL, now()),
      ('e0000000-0000-4000-8000-000000000504', '${slugs.hackathon}', 'Future of Web Hackathon', '', '2025-04-26T17:30:00Z', '2025-04-27T03:30:00Z', 400, 'Sentry, 45 Fremont St, San Francisco, CA 94105, USA', 'Sentry', 'Sentry, 45 Fremont St, San Francisco, CA 94105, USA', 'evt-hack', true, false, NULL, 'web hackathon', now()),
      ('e0000000-0000-4000-8000-000000000505', '${slugs.bare}', 'Morning Without A Venue', 'Somewhere', ${iso(bareStart)}, ${iso(hours(bareStart, 2))}, 0, NULL, NULL, NULL, NULL, false, false, NULL, NULL, now()),
      ('e0000000-0000-4000-8000-000000000506', '${slugs.draft}', 'All Things Draft', 'Secret', ${iso(dayAt(now, 3, "01:30"))}, ${iso(dayAt(now, 3, "04:30"))}, 100, NULL, NULL, NULL, 'evt-draft', false, true, NULL, NULL, now());
    INSERT INTO sponsors (id, name, about, updated_at) VALUES
      ('c0000000-0000-4000-8000-000000000501', 'CodeRabbit', 'Space, food and drinks.', now()),
      ('c0000000-0000-4000-8000-000000000502', 'Sanity', 'Space.', now()),
      ('c0000000-0000-4000-8000-000000000503', 'Clerk', 'Drinks.', now());
    INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000501', 'c0000000-0000-4000-8000-000000000501', '2026-01-01T00:00:01Z', now()),
      ('e0000000-0000-4000-8000-000000000503', 'c0000000-0000-4000-8000-000000000502', '2026-01-01T00:00:02Z', now()),
      ('e0000000-0000-4000-8000-000000000503', 'c0000000-0000-4000-8000-000000000503', '2026-01-01T00:00:03Z', now());
    INSERT INTO profiles (id, name, title, image, twitter_handle, bluesky_handle, linkedin_handle, bio, profile_type, updated_at) VALUES
      ('b0000000-0000-4000-8000-000000000501', 'Ada Lovelace', 'Engineer, Analytical Engines', 'd0000000-0000-4000-8000-000000000504', '@ada', 'ada.bsky.social', 'ada-lovelace', 'Writes the first programs.', 'member', now()),
      ('b0000000-0000-4000-8000-000000000502', 'Grace Hopper', '', NULL, NULL, NULL, NULL, '', 'member', now());
    INSERT INTO talks (id, title, description, updated_at) VALUES
      ('a0000000-0000-4000-8000-000000000501', 'A fireside chat on Effect', '<p>Typed errors &amp; <strong>services</strong>.</p><script>alert(1)</script>', now()),
      ('a0000000-0000-4000-8000-000000000502', 'Compilers, together', '', now());
    INSERT INTO talk_speakers (talk_id, speaker_id, role, created_at, updated_at) VALUES
      ('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000502', 'moderator', '2026-01-02T00:00:00Z', now()),
      ('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', 'speaker', '2026-01-02T00:00:01Z', now());
    INSERT INTO talk_speakers (talk_id, speaker_id, created_at, updated_at) VALUES
      ('a0000000-0000-4000-8000-000000000502', 'b0000000-0000-4000-8000-000000000502', '2026-01-02T00:00:02Z', now()),
      ('a0000000-0000-4000-8000-000000000502', 'b0000000-0000-4000-8000-000000000501', '2026-01-02T00:00:03Z', now());
    INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000501', 'a0000000-0000-4000-8000-000000000501', '2026-01-03T00:00:01Z', now()),
      ('e0000000-0000-4000-8000-000000000503', 'a0000000-0000-4000-8000-000000000502', '2026-01-03T00:00:02Z', now());
    INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000503', 'd0000000-0000-4000-8000-000000000503', '2026-01-04T00:00:01Z', now()),
      ('e0000000-0000-4000-8000-000000000503', 'd0000000-0000-4000-8000-000000000501', '2026-01-04T00:00:02Z', now()),
      ('e0000000-0000-4000-8000-000000000503', 'd0000000-0000-4000-8000-000000000502', '2026-01-04T00:00:03Z', now());
    INSERT INTO redirects (slug, destination_url, comment, updated_at) VALUES
      ('discord', '${redirects.discord}', 'Community chat', now()),
      ('unsafe', '${redirects.unsafe}', NULL, now());
    ${hostProfiles}
    -- The upcoming evening: a fireside chat, Luma's guest count, its
    -- organizers (Andre first) and two co-hosts; the past one has an MC.
    UPDATE talks SET format = 'fireside' WHERE id = 'a0000000-0000-4000-8000-000000000501';
    UPDATE events SET luma_guest_count = 183 WHERE id = 'e0000000-0000-4000-8000-000000000501';
    UPDATE events SET luma_guest_count = 146 WHERE id = 'e0000000-0000-4000-8000-000000000503';
    INSERT INTO event_people (event_id, profile_id, role, position, source, created_at, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000501', '${hosts[1].profileId}', 'organizer', 0, 'luma', now(), now()),
      ('e0000000-0000-4000-8000-000000000501', '${hosts[0].profileId}', 'organizer', 1, 'luma', now(), now()),
      ('e0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', 'co-host', 0, 'luma', now(), now()),
      ('e0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000502', 'co-host', 1, 'luma', now(), now()),
      ('e0000000-0000-4000-8000-000000000503', 'b0000000-0000-4000-8000-000000000502', 'mc', 0, 'site', now(), now());
    -- Posts about the past evening: two approved (one with its photo and
    -- avatar copied to the media origin), one hidden, one pending.
    INSERT INTO event_posts (event_id, platform, url, author_name, author_handle, author_url, author_avatar, posted_at, text, image, status, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000503', 'x', 'https://x.com/i/status/1884000000000000001', 'Ada Lovelace', 'ada', 'https://x.com/ada', 'd0000000-0000-4000-8000-000000000504', '2025-01-29T02:30:00Z', 'Compilers, together, at Sanity.', 'd0000000-0000-4000-8000-000000000502', 'approved', now()),
      ('e0000000-0000-4000-8000-000000000503', 'bluesky', 'https://bsky.app/profile/did:plc:grace/post/3abc', 'Grace Hopper', 'grace.example', NULL, NULL, '2025-01-29T05:00:00Z', 'Thanks, Sanity!', NULL, 'approved', now()),
      ('e0000000-0000-4000-8000-000000000503', 'x', 'https://x.com/i/status/1884000000000000003', 'Taken Down', 'gone', NULL, NULL, '2025-01-29T03:00:00Z', 'Hidden by an organizer.', NULL, 'hidden', now()),
      ('e0000000-0000-4000-8000-000000000503', 'x', 'https://x.com/i/status/1884000000000000004', 'Awaiting Review', 'later', NULL, NULL, '2025-01-29T04:00:00Z', 'Found by a search.', NULL, 'pending', now());`;
}

/** A migrated database holding the event catalog as of `now`. */
export async function eventDatabase(now: Date): Promise<PGlite> {
  const db = await migratedDatabase();
  await db.exec(eventCatalog(now));
  return db;
}
