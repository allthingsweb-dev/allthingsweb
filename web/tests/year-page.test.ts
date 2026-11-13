import { describe, expect, test } from "bun:test";
import type { Evening } from "allthings-core/src/home.ts";
import type { YearEvening, YearView } from "allthings-core/src/year.ts";
import { DateTime } from "effect";
import { built } from "../src/assets.ts";
import { ogCards } from "../src/og/cards.ts";
import { eventsPage } from "../src/pages/events.tsx";
import { statement, yearPage } from "../src/pages/year.tsx";
import { sitemapXml } from "../src/seo/sitemap.ts";
import {
  gzipped,
  headingLevels,
  htmlBudget,
  htmlProblems,
  twoDigitYears,
} from "./support/pages.ts";

/** A year's page as a pure function of fixed data. */

const at = (iso: string) => DateTime.makeUnsafe(iso);

const evening = (
  slug: string,
  iso: string,
  overrides: Partial<Evening> = {},
): Evening => ({
  slug,
  name: "Effect San Francisco",
  topic: "effect",
  status: "past",
  startsAt: at(iso),
  neighborhood: "East Cut",
  hosts: ["CodeRabbit"],
  rsvpUrl: null,
  curation: { kind: "ours" },
  ...overrides,
});

const photo = (name: string) => ({
  url: `https://media.allthings.dev/photos/${name}.jpg`,
  alt: `The room at ${name}`,
  width: 1600,
  height: 1067,
  version: "1",
});

const entry = (
  on: Evening,
  overrides: Partial<YearEvening> = {},
): YearEvening => ({
  evening: on,
  photo: photo(on.slug),
  onStage: [
    { slug: "grace-hopper", name: "Grace Hopper" },
    { slug: "ada-lovelace", name: "Ada Lovelace" },
  ],
  guests: 118,
  ...overrides,
});

const year: YearView = {
  year: 2026,
  tally: { evenings: 2, speakers: 3, hostingCompanies: 2, guests: 238 },
  evenings: [
    entry(evening("effect", "2026-03-08T02:30:00Z"), {
      onStage: [
        { slug: "grace-hopper", name: "Grace Hopper" },
        { slug: "ada-lovelace", name: "Ada Lovelace" },
        { slug: "linus", name: "Linus" },
      ],
    }),
    // No photo, no speakers, a count under the floor, no venue we know.
    entry(
      evening("2026-08-12-social", "2026-08-13T01:00:00Z", {
        name: "Summer social",
        topic: undefined,
        neighborhood: null,
        hosts: ["Acme", "Globex"],
      }),
      { photo: null, onStage: [], guests: null },
    ),
  ],
  years: [2026, 2025, 2024],
};

const origin = "https://allthings.dev";

const render = (view: YearView = year, theme?: "light" | "dark") =>
  yearPage({
    year: view,
    origin,
    theme,
    portraits: new Map(),
    images: "originals",
  });

const entries = (html: string) =>
  [...html.matchAll(/<li class="year-evening[^"]*">[\s\S]*?<\/li>/g)].map(
    ([row]) => row,
  );

describe("statement", () => {
  test("says how many said “I'm in”, over how many evenings, in the year", () => {
    expect(statement(year.tally, 2026)).toEqual({
      lead: "238 people said “I’m in.”",
      after: "2 evenings in 2026, in the neighborhoods of San Francisco.",
    });
  });

  test("says the evenings alone without guests counted", () => {
    expect(statement({ guests: 0, evenings: 1 }, 2023)).toEqual({
      lead: "1 evening for people who build software.",
      after: "In the neighborhoods of San Francisco, in 2023.",
    });
  });

  test("says what the lab's year-end retro said without a year", () => {
    expect(statement({ guests: 6929, evenings: 35 })).toEqual({
      lead: "6,929 people said “I’m in.”",
      after: "35 evenings, in the neighborhoods of San Francisco.",
    });
  });
});

describe("a year's page", () => {
  test("is titled as the year in evenings, at /year/<yyyy>, with its card", () => {
    const html = render();
    expect(html).toContain("<title>2026 in evenings · allthings/_</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://allthings.dev/year/2026"/>',
    );
    expect(html).toContain(
      `<meta property="og:image" content="${origin}${ogCards.year.src}"/>`,
    );
    expect(html).toContain(
      '<meta name="description" content="238 people said “I’m in.” 2 evenings in 2026, in the neighborhoods of San Francisco."/>',
    );
  });

  test("leads with the statement made of the year's numbers, its field of the year's photos", () => {
    const html = render();
    expect(html).toContain(
      '<h1 id="year-statement" class="depth-statement"><span>238 people said “I’m in.”</span><span class="depth-after">2 evenings in 2026, in the neighborhoods of San Francisco.</span></h1>',
    );
    // In the visitor's mode, never one of its own (brand/foundations.md).
    expect(html).not.toContain("data-theme");
    // Only the evening with a photo is in the field, as texture.
    const field = html.slice(
      html.indexOf('class="depth-field"'),
      html.indexOf('class="depth-text"'),
    );
    expect(field.match(/<img /g)?.length).toBe(1);
    expect(field).toContain('alt=""');
  });

  test("counts the year in the tally band", () => {
    expect(render()).toContain(
      '<section class="figures figures-band" aria-label="In 2026"><dl><div><dt class="at-type-meta">evenings</dt><dd>2</dd></div>',
    );
  });

  test("lists every evening in the order held, each with when, where, who hosted, who was on stage and who said “I'm in”", () => {
    const [first, second, ...more] = entries(render());
    expect(more).toEqual([]);
    expect(first).toContain('<li class="year-evening with-photo">');
    expect(first).toContain(
      '<time datetime="2026-03-08T02:30:00.000Z">2026.03.07</time><span> · East Cut</span>',
    );
    expect(first).toContain(
      '<a href="/effect">at<span class="slash">/</span><span>effect</span></a>',
    );
    expect(first).toContain("Hosted by CodeRabbit");
    expect(first).toContain(
      'On stage: <a href="/people/grace-hopper">Grace Hopper</a>, <a href="/people/ada-lovelace">Ada Lovelace</a> and <a href="/people/linus">Linus</a>',
    );
    expect(first).toContain("118 said “I’m in”");
    expect(first).toContain('alt="The room at effect"');
    expect(second).toContain("Hosted by Acme &amp; Globex");
  });

  test("shows an evening without a photo, without a slot for one, and says nothing it doesn't know", () => {
    const [, second] = entries(render());
    expect(second).toContain('<li class="year-evening">');
    expect(second).not.toContain("year-evening-photo");
    expect(second).not.toContain("<img");
    expect(second).not.toContain("On stage");
    expect(second).not.toContain("said “I’m in”");
    expect(second).toContain(
      '<time datetime="2026-08-13T01:00:00.000Z">2026.08.12</time></p>',
    );
  });

  test("leads to the other years, and to none when it is the only one", () => {
    const html = render();
    expect(html).toContain(
      '<a href="/year/2025">2025 in evenings</a></li><li><a href="/year/2024">2024 in evenings</a>',
    );
    expect(html).not.toContain('href="/year/2026"');
    expect(render({ ...year, years: [2026] })).not.toContain(
      'aria-label="Other years"',
    );
  });

  test("loads the depth field's stylesheet after the site's, and no script", () => {
    const html = render();
    const site = html.indexOf(`href="${built.stylesheet}"`);
    const depth = html.indexOf(`href="${built.depthStylesheet}"`);
    expect(site).toBeGreaterThan(-1);
    expect(depth).toBeGreaterThan(site);
    expect(html).not.toContain(built.labStylesheet);
    expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });

  test("belongs to the evenings in the header", () => {
    expect(render()).toContain(
      '<li><a href="/events" aria-current="page">events</a></li>',
    );
  });

  test("writes every date as a simple date, and no year in two digits", () => {
    const html = render();
    expect(twoDigitYears(html)).toEqual([]);
    for (const [, date] of html.matchAll(/<time\b[^>]*>([^<]*)<\/time>/g)) {
      expect(date).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    }
  });

  test("escapes what it prints and encodes slugs", () => {
    const html = render({
      ...year,
      evenings: [
        entry(
          evening("café night", "2026-12-03T02:00:00Z", {
            name: '"Acme" & <Co>',
            topic: undefined,
            hosts: ["<b>Evil</b>"],
          }),
          { onStage: [{ slug: "zoë", name: "<b>Zoë</b>" }] },
        ),
      ],
    });
    expect(html).toContain("&quot;Acme&quot; &amp; &lt;Co&gt;");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(html).toContain("&lt;b&gt;Zoë&lt;/b&gt;");
    expect(html).toContain('href="/caf%C3%A9%20night"');
    expect(html).toContain('href="/people/zo%C3%AB"');
  });

  test("stays within the page budget with forty evenings", () => {
    const many: YearView = {
      ...year,
      evenings: Array.from({ length: 40 }, (_, i) =>
        entry(evening(`evening-${i}`, "2026-06-01T01:00:00Z")),
      ),
    };
    expect(gzipped(render(many))).toBeLessThanOrEqual(htmlBudget);
  });

  test.each([
    ["the system's mode", undefined],
    ["Paper", "light"],
    ["Night", "dark"],
  ] as const)(
    "is valid HTML with one h1 and headings in order, in %s",
    async (_, theme) => {
      const html = render(year, theme);
      expect(await htmlProblems(html)).toEqual([]);
      expect(headingLevels(html)).toEqual([1, 2, 3, 3]);
    },
  );
});

describe("the evenings index", () => {
  test("links each year that held one of ours to its page by its title, and no year of only others' evenings", () => {
    const html = eventsPage({
      evenings: {
        ahead: [],
        past: [
          evening("effect", "2026-03-08T02:30:00Z"),
          evening("mastra", "2025-09-11T01:00:00Z", {
            curation: {
              kind: "shared",
              organizer: {
                name: "Mastra",
                websiteUrl: null,
                twitterHandle: null,
                blueskyHandle: null,
                linkedinHandle: null,
              },
            },
          }),
        ],
      },
      origin,
      theme: undefined,
      portraits: new Map(),
      images: "originals",
    });
    expect(html).toContain(
      '<h2 id="evenings-2026" class="list-title at-type-meta"><a href="/year/2026"><span>2026</span><span class="visually-hidden"> in evenings</span> <span aria-hidden="true">→</span></a></h2>',
    );
    expect(html).toContain(
      '<h2 id="evenings-2025" class="list-title at-type-meta">2025</h2>',
    );
    expect(html).not.toContain('href="/year/2025"');
  });
});

describe("the sitemap", () => {
  test("lists every year's page after the site's own", () => {
    const xml = sitemapXml([], origin, [], [2026, 2025]);
    expect(xml).toContain(
      "<url><loc>https://allthings.dev/brand</loc></url>\n  <url><loc>https://allthings.dev/year/2026</loc></url>\n  <url><loc>https://allthings.dev/year/2025</loc></url>",
    );
  });
});
