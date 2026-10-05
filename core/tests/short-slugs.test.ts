import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import { EventPages } from "../src/event-page.ts";
import { eventPathOf, eventUrl } from "../src/mappers.ts";
import {
  baseSlug,
  isShortSlug,
  maxBaseLength,
  planShortSlugs,
  reservedSlugs,
  type SlugSource,
  shortSlugPattern,
  slugify,
} from "../src/short-slugs.ts";
import { ShortSlugs } from "../src/slugs.ts";
import {
  clockLayer,
  now,
  seededDatabase,
  sqlLayer,
} from "./support/database.ts";

/**
 * Short links: the rule as pure functions, on production's own evenings,
 * then the step against tests/seed.sql, and event pages found by any slug
 * an evening has had.
 */

const at = (iso: string) => DateTime.makeUnsafe(iso);

const evening = (
  name: string,
  start: string,
  overrides: Partial<SlugSource> & { readonly eventId?: string } = {},
) => ({
  eventId: overrides.eventId ?? `${start}-${name}`,
  name,
  topic: null,
  curation: { kind: "ours" as const },
  startDate: at(start),
  ...overrides,
});

describe("a topic as a link", () => {
  test.each([
    ["effect", "effect"],
    ["react native", "react-native"],
    ["agent setups", "agent-setups"],
    ["web show & tell", "web-show-and-tell"],
    ["pre next.js conf meetup", "pre-nextjs-conf-meetup"],
    ["nextdev.fm live", "nextdevfm-live"],
    ["react native after-party", "react-native-after-party"],
    ["c# + f#", "c-sharp-plus-f-sharp"],
    ["it's café night", "its-cafe-night"],
    ["  --  ", ""],
  ])("%s is %s", (topic, slug) => {
    expect(slugify(topic)).toBe(slug);
  });

  test(`is at most ${maxBaseLength} characters, cut at a word`, () => {
    const slug = slugify(
      "A very long name for an evening that goes on and on about the web",
    );
    expect(slug).toBe("a-very-long-name-for-an-evening-that-goes-on-and");
    expect(slug.length).toBeLessThanOrEqual(maxBaseLength);
  });

  test("is the topic, else the name; under shared/ for an evening we share", () => {
    expect(
      baseSlug(evening("Effect San Francisco 🇺🇸", "2026-10-01T00:30:00Z")),
    ).toBe("effect");
    expect(
      baseSlug(
        evening(
          "Dev Setup Demos - Show your agents.md!",
          "2026-04-01T01:00:00Z",
          {
            topic: "dev setups",
          },
        ),
      ),
    ).toBe("dev-setups");
    expect(
      baseSlug(
        evening("Pre Next.js Conf / Ship AI Meetup", "2025-10-22T01:00:00Z"),
      ),
    ).toBe("pre-nextjs-conf-ship-ai-meetup");
    expect(
      baseSlug(
        evening("TypeScript AI Demo Day", "2026-04-09T16:00:00Z", {
          curation: { kind: "shared" },
          topic: "demo day",
        }),
      ),
    ).toBe("shared/typescript-ai-demo-day");
    expect(baseSlug(evening("🎉", "2026-10-01T00:30:00Z"))).toBe("evening");
  });

  test("always has a link's shape, which the database holds it to", () => {
    expect(shortSlugPattern).toBe("^(shared/)?[a-z0-9]+(-[a-z0-9]+)*$");
    for (const slug of [
      "effect",
      "web-2024-11",
      "shared/typescript-ai-demo-day",
    ]) {
      expect(isShortSlug(slug)).toBe(true);
    }
    for (const slug of [
      "Effect",
      "web--2024",
      "-web",
      "shared/",
      "a/b",
      "web_2024",
    ]) {
      expect(isShortSlug(slug)).toBe(false);
    }
  });
});

describe("the rule", () => {
  /** production's evenings on 2026-10-05, as the backfill gives them links */
  const production = [
    evening("Remix Bay Area at Solv", "2024-03-27T01:00:00Z"),
    evening("Remix Bay Area at Solv", "2024-05-15T01:00:00Z"),
    evening("React Bay Area at Sanity", "2024-07-31T01:00:00Z"),
    evening("All Things Web at Little Skillet", "2024-11-05T02:00:00Z"),
    evening("All Things Web @ Vercel HQ 👀", "2024-11-13T02:00:00Z"),
    evening("All Things Web at Convex", "2024-12-04T02:00:00Z"),
    evening("All Things Web Show & Tell", "2025-05-14T01:00:00Z"),
    evening("All Things Web Show & Tell", "2025-07-24T01:00:00Z"),
    evening("All Things Sync", "2026-04-30T00:30:00Z"),
    evening("All Things Agent Setups", "2026-09-16T00:30:00Z"),
    evening("Effect San Francisco 🇺🇸", "2026-10-01T00:30:00Z"),
  ];

  test("gives the first evening of a topic its bare link, and dates the later ones by month", () => {
    expect(planShortSlugs(production, []).map(({ slug }) => slug)).toEqual([
      "remix-bay-area",
      "remix-bay-area-2024-05",
      "react-bay-area",
      "web",
      "web-2024-11",
      "web-2024-12",
      "web-show-and-tell",
      "web-show-and-tell-2025-07",
      "sync",
      "agent-setups",
      "effect",
    ]);
  });

  test("takes the evenings in the order they start, whatever the order given", () => {
    const shuffled = production.toReversed();
    expect(
      planShortSlugs(shuffled, []).map(({ event, slug }) => [event.name, slug]),
    ).toEqual(
      planShortSlugs(production, []).map(({ event, slug }) => [
        event.name,
        slug,
      ]),
    );
  });

  test("never takes a link another evening holds, and dates by day, then counts, when a month is taken too", () => {
    const later = [
      evening("All Things Web", "2026-11-04T02:00:00Z", { eventId: "a" }),
      evening("All Things Web", "2026-11-12T02:00:00Z", { eventId: "b" }),
      evening("All Things Web", "2026-11-12T02:00:00Z", { eventId: "c" }),
      evening("All Things Web", "2026-11-12T02:00:00Z", { eventId: "d" }),
    ];
    expect(planShortSlugs(later, ["web"]).map(({ slug }) => slug)).toEqual([
      "web-2026-11",
      "web-2026-11-11",
      "web-2026-11-11-2",
      "web-2026-11-11-3",
    ]);
  });

  test("reads the month and day in San Francisco", () => {
    // 6 PM on November 30 in San Francisco is already December in UTC.
    expect(
      planShortSlugs(
        [evening("All Things Web", "2026-12-01T02:00:00Z")],
        ["web"],
      ).map(({ slug }) => slug),
    ).toEqual(["web-2026-11"]);
  });

  test("never names an evening after a page", () => {
    for (const topic of ["events", "people", "about", "brand", "shared", "r"]) {
      expect(reservedSlugs.has(topic)).toBe(true);
      const [given] = planShortSlugs(
        [evening(`All Things ${topic}`, "2026-11-04T02:00:00Z", { topic })],
        [],
      );
      expect(given?.slug).toBe(`${topic}-2026-11`);
    }
  });

  test("lets an evening take its own long slug, never another's", () => {
    const venue = {
      ...evening("Venue TBA", "2026-10-15T01:30:00Z"),
      slug: "venue-tba",
    };
    expect(planShortSlugs([venue], ["venue-tba"])[0]?.slug).toBe("venue-tba");
    expect(
      planShortSlugs([{ ...venue, slug: "other" }], ["venue-tba"])[0]?.slug,
    ).toBe("venue-tba-2026-10");
  });
});

describe("an evening's path", () => {
  test("is one segment, but for a shared evening's link", () => {
    expect(eventPathOf("effect")).toBe("/effect");
    expect(eventPathOf("2025-12-02-café-night")).toBe(
      "/2025-12-02-caf%C3%A9-night",
    );
    expect(eventPathOf("shared/typescript-ai-demo-day")).toBe(
      "/shared/typescript-ai-demo-day",
    );
    // A slash anywhere else stays in the segment.
    expect(eventPathOf("a/b")).toBe("/a%2Fb");
    expect(eventPathOf("shared/")).toBe("/shared%2F");
    expect(eventUrl("https://allthings.dev", "web-2024-11")).toBe(
      "https://allthings.dev/web-2024-11",
    );
  });
});

describe("the step", () => {
  const opened: Array<PGlite> = [];
  afterAll(() => Promise.all(opened.map((db) => db.close())));

  const database = async () => {
    const db = await seededDatabase();
    opened.push(db);
    return db;
  };

  const assign = (db: PGlite, dryRun = false) =>
    Effect.runPromise(
      ShortSlugs.use((slugs) => slugs.assign({ dryRun })).pipe(
        Effect.provide(
          ShortSlugs.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );

  const links = async (db: PGlite) =>
    (
      await db.query<{ slug: string; short_slug: string | null }>(
        "SELECT slug, short_slug FROM events ORDER BY start_date, id",
      )
    ).rows;

  test("gives every published evening its link, records it for good, and gives drafts none", async () => {
    const db = await database();
    const result = await assign(db);
    expect(
      result.given.map(({ slug, shortSlug }) => [slug, shortSlug]),
    ).toEqual([
      ["2025-12-02-café-night", "cafe-night"],
      ["2026-08-12-react-at-acme", "react"],
      ["2026-10-03-ends-now", "ends-now"],
      ["2026-10-03-hack-day", "hack-day"],
      ["2026-11-05-upcoming", "upcoming-meetup"],
    ]);
    expect(result.written).toBe(5);
    expect(await links(db)).toContainEqual({
      slug: "2026-09-01-draft-night",
      short_slug: null,
    });
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM events e
       JOIN event_slugs es ON es.slug = e.short_slug AND es.event_id = e.id`,
    );
    expect(rows[0]?.n).toBe(5);
    // A second run has nothing to give.
    expect(await assign(db)).toEqual({ given: [], written: 0 });
  });

  test("a dry run gives nothing", async () => {
    const db = await database();
    const before = await links(db);
    const result = await assign(db, true);
    expect(result.written).toBeNull();
    expect(result.given).toHaveLength(5);
    expect(await links(db)).toEqual(before);
  });

  test("never gives a link an evening once had, nor one the database refuses", async () => {
    const db = await database();
    await assign(db);
    // React at Acme moves to a new link; its first stays its own.
    await db.exec(`
      INSERT INTO event_slugs (slug, event_id) VALUES ('react-at-acme', 'e0000000-0000-4000-8000-000000000001');
      UPDATE events SET short_slug = 'react-at-acme' WHERE id = 'e0000000-0000-4000-8000-000000000001';
      INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, updated_at)
        VALUES ('e0000000-0000-4000-8000-000000000099', '2027-01-01-react', 'All Things React', '', '2027-01-02T02:00:00Z', '2027-01-02T05:00:00Z', 0, now());
    `);
    const { given } = await assign(db);
    expect(given.map(({ shortSlug }) => shortSlug)).toEqual(["react-2027-01"]);
    // The database holds a link to one evening, and to its shape.
    const refusal = (statement: string) =>
      db.exec(statement).then(
        () => undefined,
        (error: Error) => error.message,
      );
    expect(
      await refusal(
        "UPDATE events SET short_slug = 'react' WHERE id = 'e0000000-0000-4000-8000-000000000099'",
      ),
    ).toContain("violates foreign key constraint");
    expect(
      await refusal(
        "INSERT INTO event_slugs (slug, event_id) VALUES ('Not A Link', 'e0000000-0000-4000-8000-000000000001')",
      ),
    ).toContain("event_slugs_slug_check");
    expect(
      await refusal(
        "INSERT INTO event_slugs (slug, event_id) VALUES ('react', 'e0000000-0000-4000-8000-000000000099')",
      ),
    ).toContain("event_slugs_pkey");
  });
});

describe("event pages", () => {
  test("are found by their link, a link they had and their long slug, and say where they are", async () => {
    const db = await seededDatabase();
    try {
      await db.exec(`
        INSERT INTO event_slugs (slug, event_id) VALUES
          ('react-at-acme', 'e0000000-0000-4000-8000-000000000001'),
          ('react', 'e0000000-0000-4000-8000-000000000001');
        UPDATE events SET short_slug = 'react' WHERE id = 'e0000000-0000-4000-8000-000000000001';
      `);
      const read = (slug: string) =>
        Effect.runPromise(
          EventPages.use((pages) =>
            pages.read(slug, "https://storage.example"),
          ).pipe(
            Effect.map((page) => page.slug),
            Effect.catchTag("EventNotFound", () => Effect.succeed("not found")),
            Effect.provide(
              EventPages.layer.pipe(
                Layer.provideMerge(sqlLayer(db)),
                Layer.provideMerge(clockLayer),
              ),
            ),
          ),
        );
      for (const slug of [
        "react",
        "react-at-acme",
        "2026-08-12-react-at-acme",
      ]) {
        expect(await read(slug)).toBe("react");
      }
      // Without a link, an evening is at its long slug.
      expect(await read("2026-11-05-upcoming")).toBe("2026-11-05-upcoming");
      expect(await read("draft-night")).toBe("not found");
      expect(DateTime.isDateTime(now)).toBe(true);
    } finally {
      await db.close();
    }
  });
});
