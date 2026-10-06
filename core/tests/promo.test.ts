import { afterAll, describe, expect, test } from "bun:test";
import { openSourceProjects } from "../src/formats.ts";
import { Effect, Layer } from "effect";
import { DataSourceError, EventNotFound } from "../src/errors.ts";
import { type EventPage, EventPages, type Speaker } from "../src/event-page.ts";
import {
  blueskyHandle,
  type MeetupDraft,
  mdUrl,
  type PromoDrafts,
  promoDrafts,
  xHandle,
} from "../src/promo/drafts.ts";
import { formatDrafts } from "../src/promo/format.ts";
import {
  DraftTooLong,
  fitOn,
  fits,
  lengthOn,
  limits,
  type Platform,
  xLength,
} from "../src/promo/limits.ts";
import { Promo } from "../src/promo/promo.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Promotion drafts (src/promo/) over tests/seed.sql, plus an organizer, a
 * co-host and an MC for React at Acme, a moderated fireside chat for the
 * upcoming evening, and a tagline in the old name for Café night. Each seeded evening's drafts are
 * kept as a golden file in tests/fixtures/promo/; after an intended change,
 * regenerate them with UPDATE_GOLDEN=1 bun test tests/promo.test.ts and
 * read the diff.
 */

const db = await seededDatabase();
await db.exec(`
  INSERT INTO event_people (event_id, profile_id, role, position, source, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'organizer', 0, 'site', '2026-01-05T00:00:01Z', now()),
    ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000007', 'co-host', 0, 'site', '2026-01-05T00:00:02Z', now()),
    ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'mc', 0, 'site', '2026-01-05T00:00:03Z', now());
  UPDATE talks SET format = 'fireside' WHERE id = 'a0000000-0000-4000-8000-000000000005';
  INSERT INTO talk_speakers (talk_id, speaker_id, role, created_at, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'moderator', '2026-01-05T00:00:04Z', now());
  UPDATE events SET tagline = 'Café night at All Things Web'
    WHERE id = 'e0000000-0000-4000-8000-000000000006';
`);
afterAll(() => db.close());

const options = {
  origin: "https://allthings.example",
  photoOrigin: "https://storage.example",
};

const layer = Promo.layer.pipe(
  Layer.provideMerge(sqlLayer(db)),
  Layer.provideMerge(clockLayer),
);

const readAny = (slug: string) =>
  Effect.runPromise(
    Effect.provide(
      Promo.use((promo) => promo.drafts(slug, options)),
      layer,
    ),
  );

/** Drafts for one of our evenings, which has its Luma and Meetup drafts. */
type OursDrafts = PromoDrafts & {
  readonly luma: string;
  readonly meetup: MeetupDraft;
};

const ours = (drafts: PromoDrafts): OursDrafts => {
  const { luma, meetup } = drafts;
  if (luma === null || meetup === null) {
    throw new Error(`${drafts.title} has no Luma or Meetup draft`);
  }
  return { ...drafts, luma, meetup };
};

const read = async (slug: string): Promise<OursDrafts> =>
  ours(await readAny(slug));

const slugs = [
  "2026-08-12-react-at-acme",
  "2026-10-03-hack-day",
  "2026-11-05-upcoming",
  "2025-12-02-café-night",
] as const;

/** Every draft in `drafts`, with the platform that counts it. */
const everyDraft = (
  drafts: OursDrafts,
): ReadonlyArray<readonly [Platform, string, string]> => [
  ["luma", "luma", drafts.luma],
  ["meetup", "meetup", drafts.meetup.description],
  ...(["x", "bluesky", "linkedin", "discord"] as const).flatMap((channel) =>
    (["announce", "dayOf", "recap"] as const).map(
      (moment) =>
        [
          channel,
          `${channel} ${moment}`,
          drafts.social[channel][moment],
        ] as const,
    ),
  ),
];

/**
 * A golden file's name for `slug`, in ASCII: file systems disagree on
 * how to store "é" (macOS decomposes it), and the name must match on all.
 */
const asciiName = (slug: string) =>
  slug.normalize("NFD").replace(/[^\x20-\x7e]/g, "");

describe("golden drafts", () => {
  for (const slug of slugs) {
    test(slug, async () => {
      const text = formatDrafts(await read(slug));
      const golden = Bun.file(
        new URL(`fixtures/promo/${asciiName(slug)}.txt`, import.meta.url),
      );
      if (process.env["UPDATE_GOLDEN"] === "1") await Bun.write(golden, text);
      expect(text).toBe(await golden.text());
    });
  }
});

describe("every draft fits its platform", () => {
  for (const slug of slugs) {
    test(slug, async () => {
      for (const [platform, name, text] of everyDraft(await read(slug))) {
        expect({ name, fits: fits(platform, text) }).toEqual({
          name,
          fits: true,
        });
      }
    });
  }

  test("still fits with a crowded stage and long bios", async () => {
    const page = await readPage("2026-08-12-react-at-acme");
    const [talk] = page.talks;
    const [speaker] = talk?.speakers ?? [];
    if (talk === undefined || speaker === undefined) throw new Error("seed");
    const crowd: ReadonlyArray<Speaker> = Array.from(
      { length: 12 },
      (_, index) => ({
        ...speaker,
        id: `crowd-${index}`,
        name: `Speaker With A Rather Long Name Number ${index}`,
        bio: "Builds things for the web. ".repeat(40),
      }),
    );
    const event: EventPage = {
      ...page,
      talks: Array.from({ length: 4 }, (_, index) => ({
        ...talk,
        id: `talk-${index}`,
        speakers: crowd,
      })),
    };
    const drafts = promoDrafts({
      event,
      handles: new Map(),
      hosts: new Map(),
      origin: "o",
    });
    for (const [platform, name, text] of everyDraft(ours(drafts))) {
      expect({ name, fits: fits(platform, text) }).toEqual({
        name,
        fits: true,
      });
    }
  });
});

/** The page the drafts are made from, through the same layer. */
const readPage = (slug: string): Promise<EventPage> =>
  Effect.runPromise(
    Effect.provide(
      EventPages.use((pages) => pages.read(slug, options.photoOrigin)),
      EventPages.layer.pipe(
        Layer.provideMerge(sqlLayer(db)),
        Layer.provideMerge(clockLayer),
      ),
    ),
  );

describe("diction", () => {
  const banned = [
    /\brsvp/i,
    /\bregister/i,
    /\bsign(ed)? ?up\b/i,
    /\bsponsor/i,
    /all things web/i,
    /!/,
    /\p{Extended_Pictographic}/u,
  ];

  test("drafts never use words the brand doesn't say", async () => {
    for (const slug of slugs) {
      const drafts = await read(slug);
      const texts = [
        ...everyDraft(drafts).map(([, name, text]) => [name, text] as const),
        ["meetup checklist", drafts.meetup.checklist.join("\n")] as const,
      ];
      for (const [name, text] of texts) {
        for (const pattern of banned) {
          expect({ slug, name, says: pattern.test(text) }).toEqual({
            slug,
            name,
            says: false,
          });
        }
      }
    }
  });

  test("the sign-off only follows a commitment", async () => {
    for (const slug of slugs) {
      for (const [, name, text] of everyDraft(await read(slug))) {
        expect({ name, signsOff: text.includes("see you") }).toEqual({
          name,
          signsOff: name === "discord dayOf",
        });
      }
    }
  });

  test("an evening is named by its lockup, a daytime event says today", async () => {
    const acme = await read("2026-08-12-react-at-acme");
    expect(acme.title).toBe("all things/react");
    expect(acme.social.x.dayOf).toStartWith("Tonight: all things/react.");
    expect(acme.social.discord.dayOf).toContain("see you at/react");
    const hack = await read("2026-10-03-hack-day");
    expect(hack.social.x.dayOf).toStartWith("Today:");
  });
});

describe("Meetup", () => {
  test("seats are on Luma, at the top", async () => {
    const { meetup } = await read("2026-08-12-react-at-acme");
    expect(meetup.description).toStartWith(
      "**Seats are on Luma: [lu.ma/event/evt-react](https://lu.ma/event/evt-react).**",
    );
  });

  test("every paragraph is followed by a blank line", async () => {
    const { meetup } = await read("2026-08-12-react-at-acme");
    expect(meetup.description).not.toMatch(/[^\n]\n[^\n]/);
  });

  test("names are bold and linked, hosts to their sites", async () => {
    const { meetup, luma } = await read("2026-08-12-react-at-acme");
    for (const text of [meetup.description, luma]) {
      expect(text).toContain("**[Ada Lovelace](https://x.com/ada)**");
      // Linus's handle is stored with its @.
      expect(text).toContain("**[Linus](https://x.com/linus)**");
      // Grace's LinkedIn handle isn't one, so she links to the people page.
      expect(text).toContain(
        "**[Grace Hopper](https://allthings.example/people#p-b0000000-0000-4000-8000-000000000002)**",
      );
      expect(text).toContain(
        "Hosted at **Globex** and **[Acme](https://acme.example/)**",
      );
      expect(text).toContain("**[all things](https://luma.com/allthingsweb)**");
    }
  });

  test("five topics, one of them plain AI", async () => {
    for (const slug of slugs) {
      const { topics } = (await read(slug)).meetup;
      expect(topics).toHaveLength(5);
      expect(new Set(topics).size).toBe(5);
      expect(
        topics.filter((topic) =>
          ["Artificial Intelligence", "AI", "AI/ML"].includes(topic),
        ),
      ).toHaveLength(1);
      expect(topics).not.toContain("Artificial Intelligence Programming");
    }
  });

  test("a fireside chat names its moderator, and its format once", async () => {
    const drafts = await read("2026-11-05-upcoming");
    expect(drafts.social.x.announce).toContain(
      "a fireside chat with @future, moderated by @ada",
    );
    expect(drafts.luma).toContain("**Next month** · fireside chat");
    expect(drafts.luma).toContain(
      "**[Ada Lovelace](https://x.com/ada)**, Engineer, moderator",
    );
  });

  test("a venue named TBA is no venue", async () => {
    const drafts = await read("2026-11-05-upcoming");
    expect(drafts.meetup.venue).toBeNull();
    expect(drafts.meetup.checklist.join("\n")).toContain(
      "Location: none on record yet",
    );
    for (const [, name, text] of everyDraft(drafts)) {
      expect({ name, saysTba: text.includes("TBA") }).toEqual({
        name,
        saysTba: false,
      });
    }
    expect(drafts.gaps).toContain(
      "No host or venue is on record, so nothing says where.",
    );
  });

  test("the venue is the host's named place", async () => {
    const { meetup } = await read("2026-08-12-react-at-acme");
    expect(meetup.venue).toBe("Globex");
    expect(meetup.eventChat).toBe("https://discord.gg/B3Sm4b5mfD");
    expect(meetup.checklist.join("\n")).toContain("Attendee limit: 1");
  });
});

describe("rules", () => {
  test("a hackathon's description tells its rules word for word, once they apply", async () => {
    const before = await read("2026-10-03-hack-day");
    // Held before the rule's first day: its drafts say nothing of it.
    expect(before.luma).not.toContain("**Rules**");
    await db.exec(`UPDATE events
      SET start_date = '2026-11-07T17:00:00Z', end_date = '2026-11-08T01:00:00Z'
      WHERE slug = '2026-10-03-hack-day'`);
    try {
      const drafts = await read("2026-10-03-hack-day");
      for (const description of [drafts.luma, drafts.meetup.description]) {
        expect(description).toContain(
          `**Rules**\n\n- ${openSourceProjects.text}`,
        );
      }
    } finally {
      await db.exec(`UPDATE events
        SET start_date = '2026-10-03T16:00:00Z', end_date = '2026-10-04T01:00:00Z'
        WHERE slug = '2026-10-03-hack-day'`);
    }
  });

  test("an evening of talks has no rules of its own to tell", async () => {
    expect((await read("2026-11-05-upcoming")).luma).not.toContain("Rules");
  });
});

describe("social", () => {
  test("hosting companies are tagged by their stored handles", async () => {
    const { social, gaps } = await read("2026-08-12-react-at-acme");
    expect(social.x.announce).toContain("hosted at Globex and @acme");
    expect(social.bluesky.announce).toContain("hosted at Globex and Acme");
    expect(social.linkedin.announce).toContain("hosted at Globex and Acme");
    expect(gaps).toContain(
      "Globex has no website on record, so descriptions name it unlinked.",
    );
    expect(gaps.join("\n")).not.toContain("Acme has no website");
    // Each platform a host can't be tagged on is named.
    expect(gaps).toContain(
      "Acme has no Bluesky handle on record, so Bluesky posts name it untagged.",
    );
    expect(gaps).toContain(
      "Globex has no X or Bluesky handle on record, so posts name it untagged.",
    );
  });

  test("people are tagged by their stored handles on X and Bluesky", async () => {
    const { social } = await read("2026-08-12-react-at-acme");
    expect(social.x.announce).toContain("@ada");
    expect(social.x.announce).toContain("@linus");
    expect(social.bluesky.announce).toContain("@ada.bsky.social");
    expect(social.linkedin.announce).toContain("Ada Lovelace");
    expect(social.linkedin.announce).not.toContain("@ada");
  });

  test("the recap counts photos and approved posts and thanks their authors", async () => {
    const { social } = await read("2026-08-12-react-at-acme");
    expect(social.linkedin.recap).toContain("2 photos and 2 posts");
    expect(social.linkedin.recap).toContain("all 118 of you");
    expect(social.x.recap).toContain("Thanks for posting about it, @ada.");
    expect(social.bluesky.recap).toContain("@grace.example");
    expect(social.x.recap).not.toContain("@gone");
  });
});

describe("limits", () => {
  test("X counts every URL as 23 and wide characters as 2", () => {
    expect(xLength("hi https://example.com/a/very/long/path/indeed")).toBe(26);
    expect(xLength("日本")).toBe(4);
    expect(xLength("a👍🏽b")).toBe(4);
    expect(xLength("café — “quoted”")).toBe(15);
  });

  test("Bluesky counts graphemes", () => {
    expect(lengthOn("bluesky", "👨‍👩‍👧 é")).toBe(3);
  });

  test("fitOn takes the richest that fits, and fails past the last", () => {
    const long = "x".repeat(limits.x + 1);
    expect(fitOn("x", [long, "short"])).toBe("short");
    expect(() => fitOn("x", [long])).toThrow(DraftTooLong);
  });

  test("a link destination keeps its parentheses from ending it", () => {
    expect(mdUrl("https://en.example/wiki/Acme_(company)")).toBe(
      "<https://en.example/wiki/Acme_(company)>",
    );
    expect(mdUrl("https://acme.example/a<b>")).toBe(
      "<https://acme.example/a%3Cb%3E>",
    );
    expect(mdUrl("https://acme.example/")).toBe("https://acme.example/");
  });

  test("handles", () => {
    expect(xHandle(" @ada ")).toBe("ada");
    expect(xHandle("not a handle")).toBeNull();
    expect(xHandle("https://x.com/ada")).toBeNull();
    expect(blueskyHandle("@Ada.bsky.social")).toBe("ada.bsky.social");
    expect(blueskyHandle("ada")).toBeNull();
  });
});

describe("errors", () => {
  test("a draft or unknown slug is not found", async () => {
    for (const slug of ["2026-09-01-draft-night", "nope"]) {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.provide(
            Promo.use((promo) => promo.drafts(slug, options)),
            layer,
          ),
        ),
      );
      expect(error).toBeInstanceOf(EventNotFound);
    }
  });

  test("a closed database is a DataSourceError", async () => {
    const closed = await seededDatabase();
    await closed.close();
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          Promo.use((promo) => promo.drafts(slugs[0], options)),
          Promo.layer.pipe(
            Layer.provideMerge(sqlLayer(closed)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    expect(error).toBeInstanceOf(DataSourceError);
  });
});

describe("an evening we only share", () => {
  test("is recommended, by its organizer, and never drafted as ours", async () => {
    const shared = await seededDatabase();
    try {
      await shared.exec(`
        INSERT INTO sponsors (id, name, about, website_url, twitter_handle, bluesky_handle, updated_at) VALUES
          ('c0000000-0000-4000-8000-000000000900', 'Mastra', 'Agents in TypeScript.', 'https://mastra.ai', 'mastra', 'mastra.ai', now());
        UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000900'
          WHERE slug = '2026-11-05-upcoming';
      `);
      const drafts = await Effect.runPromise(
        Effect.provide(
          Promo.use((promo) => promo.drafts("2026-11-05-upcoming", options)),
          Promo.layer.pipe(
            Layer.provideMerge(sqlLayer(shared)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      );
      expect(drafts.title).toBe("Upcoming meetup");
      expect(drafts.luma).toBeNull();
      expect(drafts.meetup).toBeNull();
      expect(drafts.social.x.announce).toStartWith(
        "Upcoming meetup, by @mastra",
      );
      expect(drafts.social.bluesky.announce).toStartWith(
        "Upcoming meetup, by @mastra.ai",
      );
      expect(drafts.social.linkedin.announce).toContain(
        "Not one of ours: we're sharing it because we think it's good.",
      );
      for (const channel of ["x", "bluesky", "linkedin", "discord"] as const) {
        for (const moment of ["announce", "dayOf", "recap"] as const) {
          const text = drafts.social[channel][moment];
          expect(text).not.toContain("all things/");
          expect(text).not.toContain("see you");
          expect(text).not.toContain("Thank you for coming");
          expect(text).not.toContain("If you're in");
        }
      }
      expect(formatDrafts(drafts)).toContain(
        "## luma\n\nNone: this evening is shared, not ours.",
      );
      // Without a Luma page, posts link the evening's page instead.
      await shared.exec(
        "UPDATE events SET luma_event_id = NULL WHERE slug = '2026-11-05-upcoming'",
      );
      const noLuma = await Effect.runPromise(
        Effect.provide(
          Promo.use((promo) => promo.drafts("2026-11-05-upcoming", options)),
          Promo.layer.pipe(
            Layer.provideMerge(sqlLayer(shared)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      );
      for (const moment of ["announce", "dayOf"] as const) {
        expect(noLuma.social.x[moment]).toContain(
          "https://allthings.example/2026-11-05-upcoming",
        );
      }
    } finally {
      await shared.close();
    }
  });
});
