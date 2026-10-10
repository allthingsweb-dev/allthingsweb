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
import { frameLimit, phoneFrames } from "../src/pages/lab/contact-sheet.tsx";
import { statement } from "../src/pages/lab/year-end-retro.tsx";
import { letterTileLimit, letterTiles } from "../src/pages/letters.tsx";
import {
  labIndexPage,
  saved,
  variantNamed,
  variantPage,
  variants,
} from "../src/pages/lab/variants.tsx";
import {
  contentSecurityPolicy,
  scriptedContentSecurityPolicy,
} from "../src/pages/response.ts";
import { simpleDate } from "../src/pages/time.ts";
import { sitemapXml, sitePages } from "../src/seo/sitemap.ts";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/**
 * The home lab (src/pages/lab/), as pure functions of fixed data: every
 * variant is a whole home page that search engines are asked to skip, that
 * nothing on the site links to, that sets no style of its own and runs
 * no script but the lab's own, and that holds still for reduced motion.
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

/** 34 evenings held, latest first, every third without a photo here. */
const evenings = Array.from({ length: 34 }, (_, index) => ({
  slug: `evening-${index}`,
  name: `All Things Evening ${index}`,
  topic: index === 5 ? undefined : `topic ${index}`,
  startsAt: at(
    `2026-09-${String(30 - (index % 28)).padStart(2, "0")}T01:00:00Z`,
  ).pipe((start) =>
    DateTime.subtract(start, { days: 30 * Math.floor(index / 28) }),
  ),
  photo: index % 3 === 2 ? null : photo(`evening-${index}`),
}));

const community = (overrides: Partial<CommunityView> = {}): CommunityView => ({
  tally: { evenings: 34, guests: 6827, speakers: 49, hostingCompanies: 18 },
  evenings,
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
const everyName = [...names, ...saved.map((variant) => variant.name)];
const scripted = new Set(
  variants.filter((variant) => variant.scripted).map((variant) => variant.name),
);

describe("the lab", () => {
  test("has its heroes, by the idea each is named after, the interactive ones marked", () => {
    expect(names).toEqual([
      "wall",
      "contact-sheet",
      "slash-grid",
      "depth-field",
      "faces",
      "faces-mix",
      "faces-fluid",
      "faces-springs",
      "faces-ripples",
    ]);
    expect([...scripted]).toEqual([
      "depth-field",
      "faces-fluid",
      "faces-springs",
      "faces-ripples",
    ]);
    for (const variant of variants) {
      expect(variant.pitch.includes("Interactive")).toBe(
        variant.scripted === true,
      );
    }
  });

  test("keeps the first round's statement, saved for the year-end retro, out of the candidates", () => {
    expect(saved.map((variant) => variant.name)).toEqual(["year-end-retro"]);
    expect(names).not.toContain("year-end-retro");
    const html = labIndexPage(page);
    expect(html).toContain('<h2 id="saved" class="at-type-meta">Saved</h2>');
    expect(html).toContain("<strong>Saved for the year-end retro.</strong>");
    expect(html).toContain('<a href="/lab/home/year-end-retro">');
    expect(variantNamed("year-end-retro")?.name).toBe("year-end-retro");
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

describe.each(everyName)("/lab/home/%s", (name) => {
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

  test("loads the lab's stylesheet after the site's, and no script but the lab's own, where it has an engine", () => {
    const html = render(name);
    const site = html.indexOf(`href="${built.stylesheet}"`);
    const lab = html.indexOf(`href="${built.labStylesheet}"`);
    expect(site).toBeGreaterThan(-1);
    expect(lab).toBeGreaterThan(site);
    const scripts = [
      ...html.matchAll(/<script(?! type="application\/ld\+json")[^>]*>/g),
    ].map(([tag]) => tag);
    expect(scripts).toEqual(
      scripted.has(name)
        ? [`<script type="module" src="${built.labScript}">`]
        : [],
    );
    expect(html).not.toMatch(/\son[a-z]+=|javascript:|\sstyle=/i);
    expect(html.includes("data-engine=")).toBe(scripted.has(name));
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
          evenings: [],
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
  test("wall: tiles of two photos that cross, each leading to its evening", () => {
    const tiles = tilesOf(wall);
    expect(tiles).toHaveLength(21);
    expect(tiles.every((tile) => tile.length === 2)).toBe(true);
    expect(tiles[0]?.[1]).toBe(wall[21]);
    expect(tilesOf(wall.slice(0, 5)).map((tile) => tile.length)).toEqual([
      2, 2, 1,
    ]);
    const html = render("wall");
    expect(html).toContain('data-theme="dark"');
    expect(html.match(/<a href="\/(?:effect|sync)"><picture>/g)).toHaveLength(
      42,
    );
    // The first photos lead the page's loading; the ones crossing in follow.
    expect(html.match(/fetchpriority="high"/g)).toHaveLength(7);
    expect(html.match(/fetchpriority="low"/g)?.length).toBeGreaterThanOrEqual(
      21,
    );
  });

  test("contact-sheet: the latest evenings in order, a frame each, and one on to all of them", () => {
    const html = render("contact-sheet");
    const frames = [
      ...html.matchAll(/<a class="frame" href="\/([^"]+)">/g),
    ].map(([, slug]) => slug);
    // The latest, oldest first, as they happened.
    expect(frames).toEqual(
      evenings
        .slice(0, frameLimit)
        .map((held) => held.slug)
        .toReversed(),
    );
    expect(html).toContain(
      '<a class="frame frame-more" href="/events"><span class="frame-blank">every evening',
    );
    expect(html).toContain(">all 34</span>");
    expect(html).toContain(
      ">The latest 27 of our 34 evenings, in order</figcaption>",
    );
    // A frame without a photo is its lockup.
    expect(html).toContain(
      '<span class="frame-blank">at<span class="slash">/</span><span>topic 2</span></span>',
    );
    expect(html).toContain(
      '<span class="frame-blank"><span>All Things Evening 5</span>',
    );
    expect(html).toContain(`>${simpleDate(evenings[0]!.startsAt)}</time>`);
    // A phone shows the latest and the one leading on.
    expect(html.match(/class="frame-early"/g)).toHaveLength(
      frameLimit - phoneFrames,
    );
    const all = render(
      "contact-sheet",
      data({
        community: community({
          evenings: evenings.slice(0, 3),
          tally: { evenings: 3, guests: 1, speakers: 1, hostingCompanies: 1 },
        }),
      }),
    );
    expect(all).toContain(">All 3 of our evenings, in order</figcaption>");
  });

  test("slash-grid: photos cut on the slash, each leading to its evening, beside the lockup", () => {
    const html = render("slash-grid");
    expect(html).toContain(
      '<section class="hero slash-cut" aria-labelledby="next">',
    );
    expect(
      html.match(/<li><a href="\/(?:effect|sync)"><picture>/g),
    ).toHaveLength(24);
    expect(html).toContain('<span class="visually-hidden">, 2026.09.30</span>');
    expect(html).toContain("lab-tally-band");
    expect(html.match(/fetchpriority="high"/g)).toHaveLength(6);
  });

  test("depth-field: the liquid's surface over a wall of photos, still lenses on it", () => {
    const html = render("depth-field");
    expect(html).toContain(
      '<section class="liquid bleed" data-theme="dark" aria-labelledby="next" data-engine-stage="">',
    );
    expect(html).toContain(
      '<div class="liquid-field" aria-hidden="true" data-engine="liquid"><ul class="liquid-wall" data-engine-tiles="">',
    );
    expect(html.match(/class="liquid-lens liquid-lens-\d"/g)).toHaveLength(3);
    expect(html).toContain("lab-tally-columns");
    expect(html).not.toContain("people said");
  });

  test("year-end-retro: a statement of the real numbers", () => {
    expect(statement({ guests: 6827, evenings: 34 })).toEqual({
      lead: "6,827 people said “I’m in.”",
      after: "34 evenings, in the neighborhoods of San Francisco.",
    });
    expect(statement({ guests: 0, evenings: 1 })).toEqual({
      lead: "1 evening for people who build software.",
      after: "In the neighborhoods of San Francisco.",
    });
    expect(render("year-end-retro")).toContain(
      '<h1 id="depth-statement" class="depth-statement"><span>6,827 people said “I’m in.”</span>',
    );
  });

  test("faces: the faces alone, or a crowd to every four faces", () => {
    const faces = Array.from({ length: 9 }, (_, index) =>
      photo(`face-${index}`),
    );
    const crowds = [photo("crowd-a"), photo("crowd-b")];
    expect(letterTiles(faces, crowds, false).map((tile) => tile.big)).toEqual(
      Array.from({ length: 9 }, () => false),
    );
    expect(
      letterTiles(faces, crowds, true).map(
        (tile) =>
          `${tile.big ? "crowd" : "face"} ${tile.photo.url.split("/").at(-1)}`,
      ),
    ).toEqual([
      "crowd crowd-a.jpg",
      "face face-0.jpg",
      "face face-1.jpg",
      "face face-2.jpg",
      "face face-3.jpg",
      "crowd crowd-b.jpg",
      "face face-4.jpg",
      "face face-5.jpg",
      "face face-6.jpg",
      "face face-7.jpg",
      "face face-8.jpg",
    ]);
    expect(
      letterTiles(
        [
          ...faces,
          ...faces,
          ...faces,
          ...faces,
          ...faces,
          ...faces,
          ...faces,
          ...faces,
          ...faces,
          ...faces,
          ...faces,
        ],
        [
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
          ...crowds,
        ],
        true,
      ),
    ).toHaveLength(letterTileLimit);
    const html = render("faces");
    expect(html).toContain(
      '<h1 id="faces-word" class="letters-word">all<br class="letters-break"/>things<br class="letters-break"/><span class="slash">/</span>',
    );
    expect(html).toContain(
      '<p class="letters-word letters-ink" aria-hidden="true">',
    );
    expect(html).not.toContain("crowd-");
    expect(render("faces-mix")).toContain('<li class="letters-big">');
  });

  test("faces with an engine: a stage the pointer stirs, over the same still photos", () => {
    for (const engine of ["fluid", "springs", "ripples"]) {
      const html = render(`faces-${engine}`);
      expect(html).toContain('<div class="letters" data-engine-stage="">');
      expect(html).toContain(
        `<div class="letters-photos" aria-hidden="true" data-engine="${engine}"><div class="letters-track"><ul data-engine-tiles="">`,
      );
    }
    expect(render("faces-mix")).toContain('<div class="letters">');
  });

  test("a photo the page can't show takes no tile", () => {
    const elsewhere = {
      ...photo("elsewhere"),
      url: "https://elsewhere.example/a.jpg",
    };
    const html = render(
      "faces",
      data({
        community: community({
          faces: [elsewhere, photo("here")].map((face, index) => ({
            slug: `p-${index}`,
            name: `P ${index}`,
            photo: face,
          })),
        }),
      }),
    );
    expect(html).not.toContain("elsewhere.example");
    expect(html.match(/<li><picture>/g)).toHaveLength(2);
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
        /(?:^|;)\s*animation(?:-name)?:(?!\s*none)/.test(body),
      )
      .flatMap(({ selector }) => selector.split(/,\s*/));
    expect(animated.length).toBeGreaterThanOrEqual(4);
    for (const selector of animated) {
      expect(stoppedSelectors).toContain(selector);
    }
    // A transition answers the pointer; it too is cut for reduced motion.
    const settled = [...still.matchAll(/([^{}]+)\{\s*transition: none;\s*\}/g)]
      .flatMap(([, selectors = ""]) => selectors.split(","))
      .map((selector) => selector.trim());
    const transitioned = rules
      .filter(({ body }) => /(?:^|;)\s*transition:(?!\s*none)/.test(body))
      .flatMap(({ selector }) => selector.split(/,\s*/));
    expect(transitioned.length).toBeGreaterThan(0);
    for (const selector of transitioned) expect(settled).toContain(selector);
  });

  test("animates only opacity and transforms, and hides what is out of a cross", () => {
    const keyframes = [
      ...lab.matchAll(/@keyframes [a-z-]+ \{([\s\S]*?)\n\}/g),
    ].map(([, body = ""]) => body);
    expect(keyframes.length).toBeGreaterThan(3);
    for (const body of keyframes) {
      for (const [, property] of body.matchAll(/([a-z-]+):/g)) {
        expect(["opacity", "transform", "visibility"]).toContain(
          property ?? "",
        );
      }
    }
  });
});

describe("the Content-Security-Policy", () => {
  test("is the site's own, with no script, for every page without an engine", () => {
    for (const policy of Object.values(contentSecurityPolicy)) {
      expect(policy).toStartWith("default-src 'none'; style-src 'self';");
      expect(policy).not.toMatch(/script-src|unsafe-|nonce-|sha256-/);
    }
  });

  test("lets a page with an engine run this site's modules alone", () => {
    for (const mode of ["variants", "originals"] as const) {
      expect(scriptedContentSecurityPolicy[mode]).toBe(
        contentSecurityPolicy[mode].replace(
          "default-src 'none';",
          "default-src 'none'; script-src 'self';",
        ),
      );
    }
    expect(built.labScript).toMatch(/^\/assets\/lab\.[a-z0-9]+\.js$/);
  });
});
