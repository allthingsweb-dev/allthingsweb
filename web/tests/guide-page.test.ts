import { describe, expect, test } from "bun:test";
import {
  type GuideEntry,
  guideEntries,
  guideOn,
} from "allthings-core/src/guide.ts";
import { ogCards } from "../src/og/cards.ts";
import { guidePage, siteName } from "../src/pages/guide.tsx";
import { simpleDays } from "../src/pages/time.ts";
import { headingLevels, htmlProblems, twoDigitYears } from "./support/pages.ts";

/** The allthings guide as a pure function of fixed entries and a day. */

const entry = (
  id: string,
  stars: 1 | 2 | 3,
  overrides: Partial<GuideEntry> = {},
): GuideEntry => ({
  id,
  name: id,
  stars,
  city: "Portland, Oregon",
  organizer: "Someone",
  url: `https://${id}.example.com/`,
  why: "Worth going.",
  sources: [`https://${id}.example.com/`],
  ...overrides,
});

const origin = "https://allthings.dev";

const render = (
  entries: ReadonlyArray<GuideEntry>,
  today = "2026-11-13",
  theme?: "light" | "dark",
) =>
  guidePage({
    groups: guideOn(entries, today),
    origin,
    theme,
    portraits: new Map(),
    images: "originals",
  });

const entries = [
  entry("chain-react", 3, { name: "Chain React" }),
  entry("react-miami", 3, {
    name: "React Miami",
    city: "Miami, Florida",
    organizer: "G2i",
    next: { from: "2027-04-29", to: "2027-04-30" },
  }),
  entry("noisebridge", 1, { name: "Noisebridge", city: "San Francisco" }),
];

/** The entry with anchor `id`, or "" when the page has none. */
function entryHtml(html: string, id: string): string {
  const start = html.indexOf(`<li class="guide-entry" id="${id}">`);
  return start === -1
    ? ""
    : html.slice(
        start,
        html.indexOf("</ul></li>", start) + "</ul></li>".length,
      );
}

describe("simpleDays", () => {
  test.each([
    ["2027-04-29", "2027-04-29", "2027.04.29"],
    ["2027-04-29", "2027-04-30", "2027.04.29–30"],
    ["2027-04-29", "2027-05-02", "2027.04.29–05.02"],
    ["2027-12-30", "2028-01-02", "2027.12.30–2028.01.02"],
  ])("writes %s through %s as %s", (from, to, written) => {
    expect(simpleDays(from, to)).toBe(written);
  });
});

describe("the guide", () => {
  test("is titled and described as the guide, with its own card", () => {
    const html = render(entries);
    expect(html).toContain("<title>the guide · allthings/_</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://allthings.dev/guide"/>',
    );
    expect(html).toContain(
      `<meta property="og:image" content="${origin}${ogCards.guide.src}"/>`,
    );
    expect(html).toContain(
      '<h1 class="lockup at-type-event-lockup">the guide</h1>',
    );
    expect(html).toContain(
      "Three stars are worth a special journey, two a detour, one a stop.",
    );
  });

  test("belongs to the evenings in the header, as the talks library does", () => {
    expect(render(entries)).toContain(
      '<li><a href="/events" aria-current="page">events</a></li>',
    );
  });

  test("heads each star count with its stars, said in words, and what it means", () => {
    const html = render(entries);
    expect(html.match(/<h2 [^>]*>.*?<\/h2>/g)).toEqual([
      '<h2 id="stars-3" class="list-title at-type-meta"><span aria-hidden="true">★★★</span> <span class="visually-hidden">three stars: </span><span>worth a special journey</span></h2>',
      '<h2 id="stars-1" class="list-title at-type-meta"><span aria-hidden="true">★</span> <span class="visually-hidden">one star: </span><span>worth a stop</span></h2>',
    ]);
    expect(html).toContain('<p class="list-links">Plan a trip around it.</p>');
  });

  test("names each happening, with where, when and why, then who runs it and its own site", () => {
    expect(entryHtml(render(entries), "react-miami")).toBe(
      '<li class="guide-entry" id="react-miami"><h3 class="at-type-list-name">React Miami</h3><ul class="socials at-type-meta"><li>Miami, Florida</li><li><time datetime="2027-04-29">2027.04.29–30</time></li></ul><p>Worth going.</p><ul class="socials at-type-meta"><li>by G2i</li><li><a href="https://react-miami.example.com/">react-miami.example.com</a></li></ul></li>',
    );
  });

  test("names a site as people say it, without www", () => {
    expect(siteName("https://www.reactmiami.com/")).toBe("reactmiami.com");
    expect(siteName("https://www.ai.engineer/miami/2027")).toBe("ai.engineer");
  });

  test("says when a happening's dates aren't announced yet, and once its days are over", () => {
    expect(entryHtml(render(entries), "chain-react")).toContain(
      "<li>Portland, Oregon</li><li>dates not announced yet</li></ul>",
    );
    expect(entryHtml(render(entries, "2027-05-01"), "react-miami")).toContain(
      "<li>Miami, Florida</li><li>dates not announced yet</li></ul>",
    );
  });

  test("lists what is in core/backfill/guide.json, and only that", () => {
    const html = render(guideEntries);
    const ids = [
      ...html.matchAll(/<li class="guide-entry" id="([^"]+)">/g),
    ].map(([, id]) => id);
    expect(new Set(ids)).toEqual(
      new Set(guideEntries.map((listed) => listed.id)),
    );
    expect(ids.length).toBe(guideEntries.length);
  });

  test("writes every date as a simple date, and no year in two digits", () => {
    const html = render(entries);
    expect(twoDigitYears(html)).toEqual([]);
  });

  test("escapes what it prints", () => {
    const html = render([
      entry("x", 2, {
        name: "<script>alert(1)</script>",
        organizer: '"Acme" & <Co>',
      }),
    ]);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("by &quot;Acme&quot; &amp; &lt;Co&gt;");
  });

  test.each([
    ["the system's mode", undefined],
    ["Paper", "light"],
    ["Night", "dark"],
  ] as const)(
    "is valid HTML with one h1 and headings in order, in %s",
    async (_, theme) => {
      const html = render(entries, "2026-11-13", theme);
      expect(await htmlProblems(html)).toEqual([]);
      expect(headingLevels(html)).toEqual([1, 2, 3, 3, 2, 3]);
    },
  );
});
