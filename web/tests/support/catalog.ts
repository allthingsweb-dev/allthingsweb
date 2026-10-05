import type { PGlite } from "@electric-sql/pglite";
import { migratedDatabase } from "allthings-core/tests/support/database.ts";
import { hosts } from "../../src/links.ts";

/**
 * A catalog for the home page, written relative to the moment the tests
 * start: the Worker reads the wall clock in workerd, so evenings ahead are
 * always days ahead of it, and past ones are fixed dates in the past. Ids
 * are readable: e… events, c… hosts, d… images, b… profiles.
 */

export const mediaPhoto = (name: string) =>
  `https://media.allthings.dev/events/home/${name}.jpg`;

/** Erik's portrait, as his profile holds it, on the media origin. */
export const erikPortrait = "https://media.allthings.dev/profiles/erik.jpg";

/**
 * The hosts' profiles, under the ids links.ts names: Erik's with a photo on
 * the media origin, Andre's with none, so his blank avatar shows beside
 * Erik's portrait. Another profile with Andre's full name has a photo: were
 * profiles matched by name, it would show.
 */
export const hostProfiles = `
  INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
    ('d0000000-0000-4000-8000-000000000401', '${erikPortrait}', '', 'Erik Thorelli smiles at the camera', 2160, 2160, now()),
    ('d0000000-0000-4000-8000-000000000402', 'https://media.allthings.dev/profiles/not-andre.jpg', '', 'Someone else', 400, 400, now());
  INSERT INTO profiles (id, name, title, image, bio, profile_type, updated_at) VALUES
    ('${hosts[0].profileId}', 'Erik Thorelli', '', 'd0000000-0000-4000-8000-000000000401', '', 'organizer', now()),
    ('${hosts[1].profileId}', 'Andre Landgraf', '', NULL, '', 'organizer', now()),
    ('b0000000-0000-4000-8000-000000000401', 'Andre Landgraf', '', 'd0000000-0000-4000-8000-000000000402', '', 'member', now());`;

const days = (from: Date, count: number) =>
  new Date(from.getTime() + count * 24 * 60 * 60 * 1000);

/** "'2026-03-08T07:30:00.000Z'", or NULL. */
const literal = (value: string | null) =>
  value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;

interface EventRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly start: Date;
  readonly hours?: number;
  readonly street?: string | null;
  readonly luma?: string | null;
  readonly draft?: boolean;
  /** The topic the site set, for a name that yields none. */
  readonly topic?: string;
}

function insertEvents(rows: ReadonlyArray<EventRow>): string {
  const values = rows.map((row) => {
    const end = new Date(row.start.getTime() + (row.hours ?? 3) * 3_600_000);
    return `(${[
      literal(row.id),
      literal(row.slug),
      literal(row.name),
      "''",
      literal(row.start.toISOString()),
      literal(end.toISOString()),
      "100",
      literal(row.street ?? null),
      "NULL",
      "NULL",
      literal(row.luma ?? null),
      "false",
      String(row.draft ?? false),
      literal(row.topic ?? null),
      "now()",
    ].join(", ")})`;
  });
  return `INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, topic, updated_at) VALUES\n  ${values.join(",\n  ")};`;
}

/**
 * Evenings in the past, the latest first. Their dates sit on either side of
 * a daylight-saving change, where the date in San Francisco differs from
 * the date in UTC.
 */
export const past = [
  {
    // 23:30 PST on Saturday, March 7, already Sunday in UTC.
    id: "e0000000-0000-4000-8000-000000000201",
    slug: "2026-03-07-all-things-effect",
    name: "All Things Effect",
    start: new Date("2026-03-08T07:30:00Z"),
    street: "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
    listDate: "03.07.26",
  },
  {
    // 01:30 PST, after the clocks went back, on Sunday, November 2.
    id: "e0000000-0000-4000-8000-000000000202",
    slug: "2025-11-02-pre-next-js-conf-ship-ai-meetup",
    name: "Pre Next.js Conf / Ship AI Meetup",
    topic: "ship ai",
    start: new Date("2025-11-02T09:30:00Z"),
    street: "Standard Deviant Brewing Pier 70, 1070 Maryland St",
    listDate: "11.02.25",
  },
  {
    // 17:00 PDT on Monday, June 1, already Tuesday in UTC.
    id: "e0000000-0000-4000-8000-000000000203",
    slug: "2025-06-01-react-bay-area-at-mux",
    name: "React Bay Area at Mux",
    start: new Date("2025-06-02T00:00:00Z"),
    street: "Mux, 50 Beale St floor 9, San Francisco, CA 94105, USA",
    listDate: "06.01.25",
  },
  {
    id: "e0000000-0000-4000-8000-000000000204",
    slug: "2025-01-28-all-things-web-at-sanity",
    name: "All Things Web at Sanity",
    start: new Date("2025-01-29T01:00:00Z"),
    street: "351 California St, San Francisco, CA 94104, USA",
    listDate: "01.28.25",
  },
] as const;

/** The SQL of the catalog as of `now`, with or without evenings ahead. */
export function catalog(now: Date, withUpcoming: boolean): string {
  const ahead: Array<EventRow> = withUpcoming
    ? [
        {
          id: "e0000000-0000-4000-8000-000000000101",
          slug: "next-effect-sf",
          name: "Effect San Francisco 🇺🇸",
          start: days(now, 7),
          street:
            "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
          luma: "evt-next",
        },
        {
          id: "e0000000-0000-4000-8000-000000000102",
          slug: "then-js-trivia-night",
          name: "JS Trivia Night",
          start: days(now, 30),
          street: "Standard Deviant Brewing Pier 70",
        },
        {
          id: "e0000000-0000-4000-8000-000000000103",
          slug: "later-typescript-ai-after-party",
          name: "TypeScript AI: The official conference after-party",
          start: days(now, 60),
          street: "Southern Pacific Brewing, 620 Treat Ave",
        },
      ]
    : [];
  const drafts: Array<EventRow> = [
    {
      id: "e0000000-0000-4000-8000-000000000301",
      slug: "draft-soon",
      name: "All Things Draft Soon",
      start: days(now, 1),
      draft: true,
    },
    {
      id: "e0000000-0000-4000-8000-000000000302",
      slug: "draft-recent",
      name: "All Things Draft Recent",
      start: new Date("2026-03-20T01:00:00Z"),
      draft: true,
    },
  ];
  const events = [...ahead, ...past, ...drafts];
  return [
    insertEvents(events),
    `INSERT INTO sponsors (id, name, about, updated_at) VALUES
      ('c0000000-0000-4000-8000-000000000101', 'CodeRabbit', 'Space, food and drinks.', now()),
      ('c0000000-0000-4000-8000-000000000102', 'Clerk', 'Drinks.', now());`,
    `INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at) VALUES
      ${withUpcoming ? "('e0000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', '2026-01-01T00:00:01Z', now())," : ""}
      ('e0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000101', '2026-01-01T00:00:02Z', now()),
      ('e0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000102', '2026-01-01T00:00:03Z', now());`,
    `INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
      ('d0000000-0000-4000-8000-000000000201', 'https://elsewhere.example/effect.jpg', '', 'Not on the media origin', 800, 600, now()),
      ('d0000000-0000-4000-8000-000000000202', '${mediaPhoto("effect")}', '', 'Michael Arnaldi on stage at CodeRabbit', 1600, 1200, now()),
      ('d0000000-0000-4000-8000-000000000203', '${mediaPhoto("pier-70")}', '', 'The crowd at Pier 70', 1200, 900, now()),
      ('d0000000-0000-4000-8000-000000000204', '${mediaPhoto("mux")}', '', 'Pizza at Mux', 1024, 768, now()),
      ('d0000000-0000-4000-8000-000000000205', '${mediaPhoto("sanity")}', '', 'Sanity, too old to show', 1024, 768, now()),
      ('d0000000-0000-4000-8000-000000000206', '${mediaPhoto("draft")}', '', 'A draft', 1024, 768, now());`,
    `INSERT INTO event_images (event_id, image_id, created_at, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000201', '2026-01-02T00:00:01Z', now()),
      ('e0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000202', '2026-01-02T00:00:02Z', now()),
      ('e0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000203', '2026-01-02T00:00:03Z', now()),
      ('e0000000-0000-4000-8000-000000000203', 'd0000000-0000-4000-8000-000000000204', '2026-01-02T00:00:04Z', now()),
      ('e0000000-0000-4000-8000-000000000204', 'd0000000-0000-4000-8000-000000000205', '2026-01-02T00:00:05Z', now()),
      ('e0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000206', '2026-01-02T00:00:06Z', now());`,
    hostProfiles,
  ].join("\n");
}

/** A migrated database holding the catalog as of `now`. */
export async function catalogDatabase(
  now: Date,
  withUpcoming: boolean,
): Promise<PGlite> {
  const db = await migratedDatabase();
  await db.exec(catalog(now, withUpcoming));
  return db;
}
