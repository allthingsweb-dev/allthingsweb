import { describe, expect, test } from "bun:test";
import type { SafeHtml } from "../src/rich-text.ts";
import {
  blocksOf,
  type Stage,
  withoutStageRepeats,
  wordsOf,
} from "../src/stage-repeats.ts";

/**
 * Trimming Luma's descriptions of what the stage shows
 * (src/stage-repeats.ts), on real descriptions: each fixture in
 * tests/fixtures/descriptions holds an evening's description as its page
 * serves it (sanitized), and its talks as get_event lists them, read from
 * staging on 2026-10-06.
 */

interface Fixture extends Stage {
  readonly slug: string;
  readonly about: string;
}

const fixture = (slug: string): Promise<Fixture> =>
  Bun.file(
    new URL(`fixtures/descriptions/${slug}.json`, import.meta.url),
  ).json();

/** A block's first six words, as the expectations name it. */
const opening = (block: string) =>
  wordsOf(block).split(" ").slice(0, 6).join(" ");

/** What trimming drops from `slug`'s description, and what it keeps. */
const trim = async (slug: string) => {
  const evening = await fixture(slug);
  const before = blocksOf(evening.about);
  const after = blocksOf(
    withoutStageRepeats(evening.about as SafeHtml, evening),
  );
  return {
    dropped: before.filter((block) => !after.includes(block)).map(opening),
    kept: after.map(opening),
  };
};

describe("withoutStageRepeats, on real descriptions", () => {
  test("web-2024-11: Tom Occhino's bio and the talk's abstract, under their headings", async () => {
    expect(await trim("web-2024-11")).toEqual({
      dropped: [
        "an evening with tom occhino",
        "tom is the chief product officer",
        "history of react w tom occhino",
        "tom will give us all a",
      ],
      // The AMA isn't a talk on stage, so it stays, as does the rest; a
      // separator has no words.
      kept: [
        "join us for an engaging evening",
        "we ll open the doors from",
        "talks start at 6 00pm",
        "wrap up at 7 30pm and",
        "huge shoutout to vercel for hosting",
        "note all attendees will receive a",
        "",
        "ask me anything w tom occhino",
        "we have an amazing opportunity to",
        "",
        "about all things web",
        "we are a group of web",
      ],
    });
  });

  test("react-bay-area-2024-08: the whole Talks section, speakers' handles too", async () => {
    expect(await trim("react-bay-area-2024-08")).toEqual({
      dropped: [
        "talks",
        "e commerce cart implementation with new",
        "about sébastien",
        "sébastien is a passionate and accomplished",
        "twitter x plopix",
        "custom component based media players steve",
        "media players are often the last",
        "media chrome and player style are",
        "about steve",
        "steve heffernan is the creator of",
        "twitter x heff",
      ],
      kept: [
        "react bay area is back",
        "join us on august 27 at",
        "this event is sponsored hosted by",
        "about react bay area",
        "react bay area meetups are back",
        "follow us on twitter x to",
        "want to give a talk",
        "please fill out this super short",
      ],
    });
  });

  test("react-bay-area-2024-09: keeps a bio's paragraph the stage doesn't have, and its handles", async () => {
    const { dropped, kept } = await trim("react-bay-area-2024-09");
    expect(dropped).toEqual([
      "accessibility bridge between dream and reality",
      "the fast moving tech world is",
      "about daniel",
      "daniel is a staff software engineer",
      "twitter x deys co linkedin deyshin",
      "a world without limits making videos",
      "in an increasingly connected world access",
      "a world without limits making videos",
      "about pillippa",
      "i m pillippa perez pons a",
    ]);
    expect(kept).toContain("volunteering and community involvement are core");
    expect(kept).toContain("twitter x pilliin linkedin ignaciapons");
    // The list of talks up top is the description's own summary.
    expect(kept.slice(0, 3)).toEqual([
      "join us on september 24 at",
      "talks",
      "accessibility bridge between dream and reality",
    ]);
  });

  test("pre-nextjs-conf-meetup: abstracts, the Speakers section, and nothing of the hosts", async () => {
    const { dropped, kept } = await trim("pre-nextjs-conf-meetup");
    expect(dropped).toHaveLength(26);
    expect(dropped.slice(10, 13)).toEqual([
      "speakers",
      "alex bodin",
      "twitter alexandrebodin",
    ]);
    expect(kept).toEqual([
      "kick off next js conf with",
      "talks",
      "strapi 5 next js the modern",
      "sponsors",
      "this event is organized with strapi",
      "strapi",
      "strapi is the leading open source",
      "mux",
      "we think your video can do",
      "bigcommerce",
      "bigcommerce nasdaq bigc is a leading",
      "neon",
      "neon is building open source cloud",
      "inngest",
      "inngest s durable functions replace queues",
      "about all things web",
      "we are a group of web",
    ]);
  });

  test("web-2025-05: a description that only lists its talks is kept whole", async () => {
    const evening = await fixture("web-2025-05");
    expect(withoutStageRepeats(evening.about as SafeHtml, evening)).toBe(
      evening.about as SafeHtml,
    );
  });

  test("keeps every block it doesn't drop as it was, in order, and trims once", async () => {
    for (const slug of [
      "web-2024-11",
      "react-bay-area-2024-08",
      "react-bay-area-2024-09",
      "pre-nextjs-conf-meetup",
    ]) {
      const evening = await fixture(slug);
      const before = blocksOf(evening.about);
      const trimmed = withoutStageRepeats(evening.about as SafeHtml, evening);
      const after = blocksOf(trimmed);
      expect(after).toEqual(before.filter((block) => after.includes(block)));
      expect(withoutStageRepeats(trimmed, evening)).toBe(trimmed);
    }
  });
});

describe("withoutStageRepeats", () => {
  const bio =
    "Ada writes compilers for the analytical engine, mostly at night, and teaches.";
  const stage: Stage = {
    talks: [
      {
        title: "Engines",
        description: "<p>How the engine weaves algebraic patterns.</p>",
        speakers: [{ name: "Ada Lovelace", bio }],
      },
    ],
  };
  const trimmed = (html: string, on: Stage = stage): string =>
    withoutStageRepeats(html as SafeHtml, on);

  test("drops a block the stage holds, whatever its markup, quotes or case", () => {
    expect(
      trimmed(
        `<p>Come by.</p><p><strong>ADA</strong> writes compilers for the analytical engine — mostly at night — and teaches!</p>`,
      ),
    ).toBe("<p>Come by.</p>");
  });

  test("reads a raw bio's character references as the sanitized description spells them", () => {
    const raw: Stage = {
      talks: [
        {
          title: "Carts",
          description: null,
          speakers: [
            {
              name: "S&#233;bastien Morel",
              bio: "S&#233;bastien leads teams that build carts &amp; checkouts&#x2026; in Paris.",
            },
          ],
        },
      ],
    };
    expect(
      trimmed(
        "<p>Come by.</p><p><strong>About Sébastien</strong></p><p>Sébastien leads teams that build carts &amp; checkouts… in Paris.</p>",
        raw,
      ),
    ).toBe("<p>Come by.</p>");
    expect(wordsOf("caf&eacute;&nbsp;&#9999999;au&Unknown;lait")).toBe(
      "café au unknown lait",
    );
  });

  test("keeps a short line, and a block that only shares some words", () => {
    const html =
      "<p>Ada writes compilers.</p><p>Ada writes compilers for the analytical engine, and you will love this evening of talks about them.</p>";
    expect(trimmed(html)).toBe(html);
  });

  test("keeps a heading that names no one on stage, and one over a block it keeps", () => {
    const html = `<p><strong>Doors at 5</strong></p><p>Food first.</p><p>${bio}</p><p><strong>Ada Lovelace</strong></p><p>Bring questions.</p>`;
    expect(trimmed(html)).toBe(
      "<p><strong>Doors at 5</strong></p><p>Food first.</p><p><strong>Ada Lovelace</strong></p><p>Bring questions.</p>",
    );
  });

  test("changes nothing without a stage", () => {
    const html = `<p>${bio}</p>`;
    expect(trimmed(html, { talks: [] })).toBe(html);
  });

  test("reads blocks as the sanitizer writes them, with text between them as its own", () => {
    expect(
      blocksOf("<p>a<br>b</p>\n<ul><li>c</li><li><p>d</p></li></ul>tail<hr>"),
    ).toEqual([
      "<p>a<br>b</p>",
      "<ul><li>c</li><li><p>d</p></li></ul>",
      "tail",
      "<hr>",
    ]);
  });
});
