import { afterAll, describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { type EventPage, EventPages } from "../src/event-page.ts";
import { formatLaunch, launchJson } from "../src/promo/format.ts";
import {
  formerName,
  type LaunchConfig,
  type LaunchDrafts,
  launchDrafts,
  launchXHandle,
  type NextEvening,
  nextEveningOf,
} from "../src/promo/launch.ts";
import { fits, type Platform } from "../src/promo/limits.ts";
import {
  clockLayer,
  now,
  seededDatabase,
  sqlLayer,
} from "./support/database.ts";

/**
 * The rebrand's launch kit (src/promo/launch.ts): placeholders until the X
 * handle and the next evening are settled, and the same drafts with both.
 * Each rendering is kept as a golden file in tests/fixtures/promo/; after
 * an intended change, regenerate them with
 * UPDATE_GOLDEN=1 bun test tests/promo-launch.test.ts and read the diff.
 */

const db = await seededDatabase();
afterAll(() => db.close());

const origin = "https://allthings.dev";

const readPage = (slug: string): Promise<EventPage> =>
  Effect.runPromise(
    Effect.provide(
      EventPages.use((pages) => pages.read(slug, "https://storage.example")),
      EventPages.layer.pipe(
        Layer.provideMerge(sqlLayer(db)),
        Layer.provideMerge(clockLayer),
      ),
    ),
  );

const upcoming = await readPage("2026-11-05-upcoming");

const next = (event: EventPage): NextEvening => {
  const evening = nextEveningOf(event, origin, now);
  if (typeof evening === "string") throw new Error(`not next: ${evening}`);
  return evening;
};

const placeholders: LaunchConfig = { origin, xHandle: null, next: null };

const settled: LaunchConfig = {
  origin,
  xHandle: "allthingsdev",
  next: next(upcoming),
};

/** A next evening with every part, the longest each is likely to be. */
const hosted: NextEvening = {
  title: "allthings/react native",
  when: "Wed Sep 30, 5:30 PM",
  where: "hosted at CodeRabbit and Acme Developer Tools in Potrero Hill",
  url: `${origin}/react-native-2026-09-30`,
};

/** Every draft in the kit, with the platform that counts it, if any. */
const everyDraft = (
  drafts: LaunchDrafts,
): ReadonlyArray<readonly [Platform | null, string, string]> => [
  ...drafts.x.map((post, index) => ["x", `x ${index + 1}`, post] as const),
  ["bluesky", "bluesky", drafts.bluesky],
  ["linkedin", "linkedin", drafts.linkedin],
  ["discord", "discord", drafts.discord],
  ["luma", "luma subject", drafts.luma.subject],
  ["luma", "luma", drafts.luma.body],
  ...drafts.meetup.flatMap(
    ({ group, subject, body }) =>
      [
        ["meetup", `meetup ${group.name} subject`, subject],
        ["meetup", `meetup ${group.name}`, body],
      ] as const,
  ),
  [null, "about", drafts.about],
];

describe("golden drafts", () => {
  for (const [name, config] of [
    ["launch-placeholders", placeholders],
    ["launch-settled", settled],
  ] as const) {
    test(name, async () => {
      const text = formatLaunch(launchDrafts(config));
      const golden = Bun.file(
        new URL(`fixtures/promo/${name}.txt`, import.meta.url),
      );
      if (process.env["UPDATE_GOLDEN"] === "1") await Bun.write(golden, text);
      expect(text).toBe(await golden.text());
    });
  }
});

describe("every draft fits its platform", () => {
  const configs: ReadonlyArray<readonly [string, LaunchConfig]> = [
    ["placeholders", placeholders],
    ["settled", settled],
    // X's longest handle, and a next evening with every part.
    ["longest", { origin, xHandle: "a234567890b2345", next: hosted }],
  ];
  for (const [label, config] of configs) {
    test(label, () => {
      for (const [platform, name, text] of everyDraft(launchDrafts(config))) {
        if (platform === null) continue;
        expect({ name, fits: fits(platform, text) }).toEqual({
          name,
          fits: true,
        });
      }
    });
  }

  test("however long the next evening's name, Bluesky keeps the redirect and what's new", () => {
    for (const title of [
      "allthings/upcoming meetup and something else",
      `allthings/${"x".repeat(120)}`,
    ]) {
      const { bluesky } = launchDrafts({
        ...settled,
        next: { ...hosted, title },
      });
      expect(fits("bluesky", bluesky)).toBe(true);
      expect(bluesky).toContain("allthingsweb.dev redirects there.");
      expect(bluesky).toContain(
        "New: short links, person pages, shared evenings and at/hack.",
      );
      expect(bluesky).toContain(hosted.url);
    }
  });

  test("a next evening with every part is named whole where there is room", () => {
    const drafts = launchDrafts({ origin, xHandle: null, next: hosted });
    expect(drafts.x.at(-1)).toContain(`${hosted.when}, ${hosted.where}.`);
    expect(drafts.linkedin).toContain(`${hosted.when}, ${hosted.where}.`);
    for (const { body } of drafts.meetup) expect(body).toContain(hosted.url);
  });
});

describe("diction", () => {
  const banned = [
    /\brsvp/i,
    /\bregister/i,
    /\bsign(ed)? ?up\b/i,
    /\bsponsor/i,
    /\bevents?\b/i,
    /\bjoin us\b/i,
    /see you/i,
    /!/,
    /\p{Extended_Pictographic}/u,
  ];

  test("drafts never use words the brand doesn't say", () => {
    for (const config of [placeholders, settled]) {
      const drafts = launchDrafts(config);
      const texts = [
        ...everyDraft(drafts).map(([, name, text]) => [name, text] as const),
        ["checklist", drafts.checklist.join("\n")] as const,
      ];
      for (const [name, text] of texts) {
        for (const pattern of banned) {
          expect({
            name,
            pattern: String(pattern),
            says: pattern.test(text),
          }).toEqual({ name, pattern: String(pattern), says: false });
        }
      }
    }
  });

  test("the old name is said once a message, as what we were, never on /about", () => {
    const drafts = launchDrafts(settled);
    // As each is read: the thread whole, a subject with its body.
    const messages: ReadonlyArray<readonly [string, string, number]> = [
      ["x thread", drafts.x.join("\n\n"), 1],
      ["bluesky", drafts.bluesky, 1],
      ["linkedin", drafts.linkedin, 1],
      ["discord", drafts.discord, 1],
      ["luma", `${drafts.luma.subject}\n\n${drafts.luma.body}`, 1],
      ...drafts.meetup.map(
        ({ group, subject, body }) =>
          [`meetup ${group.name}`, `${subject}\n\n${body}`, 1] as const,
      ),
      ["about", drafts.about, 0],
    ];
    for (const [name, text, expected] of messages) {
      const times = text.split(formerName).length - 1;
      expect({ name, times }).toEqual({ name, times: expected });
    }
    expect(drafts.x[0]).toStartWith(`${formerName} is now allthings.`);
  });
});

describe("what isn't settled", () => {
  test("each unsettled value is a gap, and a placeholder in the drafts", () => {
    const drafts = launchDrafts(placeholders);
    expect(drafts.gaps).toHaveLength(2);
    expect(drafts.gaps[0]).toContain("@allthings or @allthingsdev");
    expect(drafts.gaps[1]).toContain("--next <slug>");
    expect(drafts.linkedin).toContain("x.com/[x-handle]");
    expect(drafts.x.at(-1)).toContain(`${origin}/[next]`);
  });

  test("once settled, no gap and no placeholder is left", () => {
    const drafts = launchDrafts(settled);
    expect(drafts.gaps).toEqual([]);
    const all = JSON.stringify(launchJson(drafts));
    expect(all).not.toContain("[x-handle]");
    expect(all).not.toContain("[next");
    expect(drafts.checklist).toContain(
      "Post the X thread from @allthingsdev, each post a reply to the one before.",
    );
    expect(drafts.discord).toContain("**@allthingsdev**");
    expect(drafts.luma.body).toContain("(https://x.com/allthingsdev)");
  });

  test("the handle is one value, written with or without its @", () => {
    expect(launchXHandle).toBeNull();
    expect(
      launchDrafts({ ...settled, xHandle: "@allthingsdev" }).linkedin,
    ).toBe(launchDrafts(settled).linkedin);
    expect(() => launchDrafts({ ...settled, xHandle: "all things" })).toThrow(
      "Not an X handle: all things",
    );
  });
});

describe("the next evening", () => {
  test("is named by its lockup, its time in San Francisco and its short link", () => {
    expect(next(upcoming)).toEqual({
      title: "allthings/upcoming meetup",
      when: "Thu Nov 5, 6:00 PM",
      where: null,
      url: `${origin}/${upcoming.slug}`,
    });
  });

  test("is one of ours that hasn't ended", async () => {
    const past = await readPage("2025-12-02-café-night");
    expect(nextEveningOf(past, origin, now)).toBe("ended");
    expect(
      nextEveningOf(
        upcoming,
        origin,
        DateTime.addDuration(upcoming.endsAt, "1 minute"),
      ),
    ).toBe("ended");
    const shared: EventPage = {
      ...upcoming,
      curation: {
        kind: "shared",
        organizer: {
          name: "Someone Else",
          websiteUrl: null,
          twitterHandle: null,
          blueskyHandle: null,
          linkedinHandle: null,
        },
      },
    };
    expect(nextEveningOf(shared, origin, now)).toBe("shared");
  });
});

describe("JSON", () => {
  test("each draft carries its length and its platform's limit", () => {
    const json = launchJson(launchDrafts(settled), ["x", "about", "meetup"]);
    expect(Object.keys(json)).toEqual([
      "gaps",
      "checklist",
      "x",
      "meetup",
      "about",
    ]);
    expect(json.about).toMatchObject({ limit: null });
    expect(json.x).toHaveLength(6);
    expect(json.meetup?.[1]?.body).toMatchObject({ limit: 5000 });
  });
});
