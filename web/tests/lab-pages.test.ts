import { describe, expect, test } from "bun:test";
import type { CommunityView } from "allthings-core/src/community.ts";
import type { Evening, HomeView } from "allthings-core/src/home.ts";
import { reservedSlugs } from "allthings-core/src/short-slugs.ts";
import { DateTime } from "effect";
import { built } from "../src/assets.ts";
import { sections } from "../src/pages/document.tsx";
import type { LabData, LabPage } from "../src/pages/lab/lab.tsx";
import { labPath, variantPath } from "../src/pages/lab/paths.ts";
import { tilesOf } from "../src/pages/lab/wall.tsx";
import { sheetCaption } from "../src/pages/lab/contact-sheet.tsx";
import { statement } from "../src/pages/lab/depth-field.tsx";
import { mosaicOf, mosaicCount } from "../src/pages/lab/faces.tsx";
import {
  labIndexPage,
  variantNamed,
  variantPage,
  variants,
} from "../src/pages/lab/variants.tsx";
import { contentSecurityPolicy } from "../src/pages/response.ts";
import { sitemapXml, sitePages } from "../src/seo/sitemap.ts";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/**
 * The home lab (src/pages/lab/), as pure functions of fixed data: every
 * variant is a whole home page that search engines are asked to skip, that
 * nothing on the site links to, that runs no script and sets no style of
 * its own, and that holds still for reduced motion.
 */

const at = (iso: string) => DateTime.makeUnsafe(iso);

const evening = (overrides: Partial<Evening> = {}): Evening => ({
  slug: "2026-10-28-all-things-trivia",
  name: "All Things Trivia",
  topic: "trivia",
  status: "upcoming",
  startsAt: at("2026-10-29T01:00:00Z"),
  neighborhood: "East Cut",
  hosts: ["CodeRabbit"],
  rsvpUrl: "https://lu.ma/event/evt-trivia",
  curation: { kind: "ours" },
  ...overrides,
});

const photo = (name: string) => ({
  url: `https://media.allthings.dev/events/${name}.jpg`,
  alt: `${name} at the evening`,
  width: 1600,
  height: 1200,
  version: "1767323045",
});

const home = (overrides: Partial<HomeView> = {}): HomeView => ({
  next: evening(),
  afterThat: [],
  recently: [
    evening({
      slug: "effect",
      name: "All Things Effect",
      topic: "effect",
      status: "past",
      startsAt: at("2026-10-01T00:30:00Z"),
    }),
  ],
  photos: [],
  ...overrides,
});

const wall = Array.from({ length: 42 }, (_, index) => ({
  photo: photo(`crowd-${index}`),
  slug: index % 2 === 0 ? "effect" : "sync",
  startsAt: at(
    index % 2 === 0 ? "2026-10-01T00:30:00Z" : "2025-04-30T01:00:00Z",
  ),
}));

const community = (overrides: Partial<CommunityView> = {}): CommunityView => ({
  tally: { evenings: 34, guests: 6827, speakers: 49, hostingCompanies: 18 },
  wall,
  faces: Array.from({ length: 45 }, (_, index) => ({
    slug: `person-${index}`,
    name: `Person ${index}`,
    photo: photo(`face-${index}`),
  })),
  ...overrides,
});

const page: LabPage = {
  origin: "https://allthings.dev",
  theme: undefined,
  portraits: new Map(),
  images: "variants",
};

const data = (
  overrides: { home?: HomeView; community?: CommunityView } = {},
): LabData => ({
  home: overrides.home ?? home(),
  community: overrides.community ?? community(),
});

const render = (name: string, from: LabData = data()) => {
  const variant = variantNamed(name);
  if (variant === undefined) throw new Error(`No variant ${name}`);
  return variantPage(variant, from, page);
};

const names = variants.map((variant) => variant.name);

describe("the lab", () => {
  test("has its five heroes, by the idea each is named after", () => {
    expect(names).toEqual([
      "wall",
      "contact-sheet",
      "slash-band",
      "depth-field",
      "faces",
    ]);
  });

  test("lists every variant with its line, and today's home", () => {
    const html = labIndexPage(page);
    for (const variant of variants) {
      expect(html).toContain(`<a href="${variantPath(variant.name)}">`);
      expect(html).toContain(variant.pitch.replaceAll("’", "’"));
    }
    expect(html).toContain('<a href="/">');
  });

  test("is at /lab/home, and no evening may take its path", () => {
    expect(labPath).toBe("/lab/home");
    expect(reservedSlugs.has("lab")).toBe(true);
  });

  test("is in neither the header, the sitemap nor the feed's site pages", () => {
    expect(sections.map((section) => section.path)).not.toContain(labPath);
    expect(sitePages.some((path) => path.startsWith("/lab"))).toBe(false);
    expect(sitemapXml([], page.origin)).not.toContain("/lab");
    for (const html of [labIndexPage(page), render("wall")]) {
      const header = /<header class="site-header">(.*?)<\/header>/.exec(
        html,
      )?.[1];
      expect(header).not.toContain("/lab");
    }
  });
});

describe.each(names)("/lab/home/%s", (name) => {
  test("is valid HTML, with one h1 and headings in order", async () => {
    const html = render(name);
    expect(await htmlProblems(html)).toEqual([]);
    const levels = headingLevels(html);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.forEach((level, index) => {
      expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1);
    });
  });

  test("asks search engines to stay out, at its own address", () => {
    const html = render(name);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain(
      `<link rel="canonical" href="https://allthings.dev${variantPath(name)}"/>`,
    );
  });

  test("loads the lab's stylesheet after the site's, and runs no script", () => {
    const html = render(name);
    const site = html.indexOf(`href="${built.stylesheet}"`);
    const lab = html.indexOf(`href="${built.labStylesheet}"`);
    expect(site).toBeGreaterThan(-1);
    expect(lab).toBeGreaterThan(site);
    expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/);
    expect(html).not.toMatch(/\son[a-z]+=|javascript:|\sstyle=/i);
  });

  test("is a whole home page: the hero, then home's sentences and lists", () => {
    const html = render(name);
    expect(html).toContain('<div class="band">');
    expect(html).toContain("Evenings for people who build software.");
    expect(html).toContain('id="recently"');
  });

  test("leads with the next evening, or the open slot when none is announced", () => {
    const announced = render(name);
    expect(announced).toContain(">Next · Wed Oct 28 · 6:00 PM</time>");
    expect(announced).toContain('href="https://lu.ma/event/evt-trivia"');
    const quiet = render(name, data({ home: home({ next: undefined }) }));
    expect(quiet).toContain("Next · soon");
    expect(quiet).toContain("Subscribe on Luma");
  });

  test("shows no photo and no number it doesn't have", async () => {
    const empty = render(
      name,
      data({
        community: community({
          wall: [],
          faces: [],
          tally: { evenings: 0, guests: 0, speakers: 0, hostingCompanies: 0 },
        }),
      }),
    );
    expect(await htmlProblems(empty)).toEqual([]);
    expect(empty).not.toContain('<img src="/img/');
    expect(empty).not.toContain("<picture>");
    expect(empty).not.toContain("6,827");
  });
});

describe("the variants' parts", () => {
  test("wall: tiles of two photos that cross, at most 21", () => {
    const tiles = tilesOf(wall);
    expect(tiles).toHaveLength(21);
    expect(tiles.every((tile) => tile.length === 2)).toBe(true);
    expect(tiles[0]?.[1]).toBe(wall[21]);
    expect(tilesOf(wall.slice(0, 5)).map((tile) => tile.length)).toEqual([
      2, 2, 1,
    ]);
    const html = render("wall");
    expect(html).toContain('data-theme="dark"');
    // The wall is texture beside the real text: its photos say nothing.
    expect(html.match(/<img [^>]*alt=""/g)?.length).toBe(42);
  });

  test("contact-sheet: thirty-six frames, each dated and leading to its evening", () => {
    const html = render("contact-sheet");
    expect(html.match(/<a class="frame"/g)).toHaveLength(36);
    expect(html).toContain('<a class="frame" href="/effect"><picture>');
    expect(html).toContain(">09.30.26</time>");
    expect(html).toContain(">04.29.25</time>");
    expect(sheetCaption(wall.slice(0, 36))).toBe("From 2 evenings, 2025–2026");
    expect(sheetCaption(wall.slice(0, 1))).toBe("From 1 evening, 2026");
  });

  test("slash-band: the neon slash, the tally in columns and the band twice for its loop", () => {
    const html = render("slash-band");
    expect(html.match(/<svg class="neon /g)).toHaveLength(4);
    expect(html).toContain("lab-tally-columns");
    expect(html).not.toContain("hosting companies");
    expect(html).toContain('<ul aria-hidden="true">');
    expect(html).toContain(">From the evenings</h2>");
  });

  test("depth-field: a statement of the real numbers", () => {
    expect(statement({ guests: 6827, evenings: 34 })).toEqual({
      lead: "6,827 people said “I’m in.”",
      after: "34 evenings, in the neighborhoods of San Francisco.",
    });
    expect(statement({ guests: 0, evenings: 1 })).toEqual({
      lead: "1 evening for people who build software.",
      after: "In the neighborhoods of San Francisco.",
    });
    expect(render("depth-field")).toContain(
      '<h1 id="depth-statement" class="depth-statement"><span>6,827 people said “I’m in.”</span>',
    );
  });

  test("faces: the wordmark as the heading, over two faces to each crowd", () => {
    // Every face and every crowd, up to the mosaic's tiles.
    const tiles = mosaicOf(community());
    expect(tiles).toHaveLength(Math.min(45 + 42, mosaicCount));
    expect(mosaicOf(community({ wall: [...wall, ...wall] }))).toHaveLength(
      mosaicCount,
    );
    expect(tiles.slice(0, 3).map((tile) => tile.url)).toEqual([
      photo("face-0").url,
      photo("face-1").url,
      photo("crowd-0").url,
    ]);
    // A photo the page can't show takes no tile: the mosaic is still full.
    const elsewhere = {
      ...photo("elsewhere"),
      url: "https://elsewhere.example/a.jpg",
    };
    const crowded = render(
      "faces",
      data({
        community: community({
          faces: Array.from({ length: 90 }, (_, index) => ({
            slug: `person-${index}`,
            name: `Person ${index}`,
            photo: index < 45 ? elsewhere : photo(`face-${index}`),
          })),
          wall: [...wall, ...wall],
        }),
      }),
    );
    expect(crowded).not.toContain("elsewhere.example");
    expect(crowded.match(/<li><picture>/g)).toHaveLength(2 * mosaicCount);
    const html = render("faces");
    expect(html).toContain(
      '<h1 id="faces-word" class="faces-word">all<br class="faces-break"/>things<br class="faces-break"/><span class="slash">/</span>',
    );
    expect(html).toContain(
      '<p class="faces-word faces-ink" aria-hidden="true">',
    );
  });
});

/** lab.css, and its rules selector by selector. */
const lab = await Bun.file(
  new URL("../src/styles/lab.css", import.meta.url),
).text();
const rules = [
  ...lab.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, selector = "", body = ""]) => ({ selector: selector.trim(), body }));

describe("lab.css", () => {
  test("stops every animation for people who prefer reduced motion", () => {
    const start = lab.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const still = lab.slice(start);
    const stopped = /([^{}]+)\{\s*animation: none;\s*\}/.exec(still)?.[1];
    const stoppedSelectors = (stopped ?? "")
      .split(",")
      .map((selector) => selector.trim());
    const animated = rules
      .filter(({ body }) =>
        /(?:^|;)\s*animation(?:-name)?:\s*(?!none)/.test(body),
      )
      .flatMap(({ selector }) => selector.split(/,\s*/));
    expect(animated.length).toBeGreaterThan(5);
    for (const selector of animated) {
      expect(stoppedSelectors).toContain(selector);
    }
  });

  test("animates only opacity and transforms", () => {
    const keyframes = [
      ...lab.matchAll(/@keyframes [a-z-]+ \{([\s\S]*?)\n\}/g),
    ].map(([, body = ""]) => body);
    expect(keyframes.length).toBeGreaterThan(3);
    for (const body of keyframes) {
      for (const [, property] of body.matchAll(/([a-z-]+):/g)) {
        expect(["opacity", "transform"]).toContain(property ?? "");
      }
    }
  });
});

describe("the Content-Security-Policy", () => {
  test("is the site's own, which the lab adds nothing to", () => {
    for (const policy of Object.values(contentSecurityPolicy)) {
      expect(policy).toStartWith("default-src 'none'; style-src 'self';");
      expect(policy).not.toMatch(/script-src|unsafe-|nonce-|sha256-/);
    }
  });
});
