import { describe, expect, test } from "bun:test";
import type { Evening, HomeView } from "allthings-core/src/home.ts";
import { DateTime } from "effect";
import { hosts } from "../src/links.ts";
import {
  type HomeProps,
  homePage,
  hostNames,
  lockupSize,
} from "../src/pages/home.tsx";
import { clockTime, day, listDate } from "../src/pages/time.ts";
import { htmlProblems } from "./support/pages.ts";

/** The home page and its times, as pure functions of fixed data. */

const at = (iso: string) => DateTime.makeUnsafe(iso);

/** Intl's San Francisco wall clock: an oracle independent of time.ts. */
const oracle = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    ...options,
  })
    .format(date)
    .replaceAll(" ", " ")
    .replace(",", "");

describe("times in San Francisco", () => {
  test.each([
    // An evening: 5:30 PM on Wednesday, already Thursday in UTC.
    ["2026-10-01T00:30:00Z", "09.30.26", "Wed Sep 30", "5:30 PM"],
    // Spring forward: 1:59 AM PST, then 3:00 AM PDT a minute later.
    ["2026-03-08T09:59:00Z", "03.08.26", "Sun Mar 8", "1:59 AM"],
    ["2026-03-08T10:00:00Z", "03.08.26", "Sun Mar 8", "3:00 AM"],
    // Before the change, the evening of the 7th is the 8th in UTC.
    ["2026-03-08T07:30:00Z", "03.07.26", "Sat Mar 7", "11:30 PM"],
    // Fall back: 1:30 AM happens twice, an hour apart.
    ["2025-11-02T08:30:00Z", "11.02.25", "Sun Nov 2", "1:30 AM"],
    ["2025-11-02T09:30:00Z", "11.02.25", "Sun Nov 2", "1:30 AM"],
    ["2025-11-03T02:00:00Z", "11.02.25", "Sun Nov 2", "6:00 PM"],
    // Midnight and noon.
    ["2026-01-01T08:00:00Z", "01.01.26", "Thu Jan 1", "12:00 AM"],
    ["2026-07-04T19:05:00Z", "07.04.26", "Sat Jul 4", "12:05 PM"],
  ])("%s is %s, %s, %s", (iso, date, weekday, time) => {
    expect(listDate(at(iso))).toBe(date);
    expect(day(at(iso))).toBe(weekday);
    expect(clockTime(at(iso))).toBe(time);
  });

  test("agree with Intl every 37 minutes across both changes of 2026", () => {
    for (const [from, to] of [
      ["2026-03-06T00:00:00Z", "2026-03-10T00:00:00Z"],
      ["2026-10-30T00:00:00Z", "2026-11-03T00:00:00Z"],
    ] as const) {
      for (
        let ms = Date.parse(from);
        ms < Date.parse(to);
        ms += 37 * 60 * 1000
      ) {
        const date = new Date(ms);
        const instant = DateTime.makeUnsafe(ms);
        expect(listDate(instant)).toBe(
          oracle(date, {
            month: "2-digit",
            day: "2-digit",
            year: "2-digit",
          }).replaceAll("/", "."),
        );
        expect(day(instant)).toBe(
          oracle(date, { weekday: "short", month: "short", day: "numeric" }),
        );
        expect(clockTime(instant)).toBe(
          oracle(date, { hour: "numeric", minute: "2-digit" }),
        );
      }
    }
  });
});

const evening = (overrides: Partial<Evening> = {}): Evening => ({
  slug: "2026-09-30-all-things-effect",
  name: "Effect San Francisco",
  topic: "effect",
  status: "upcoming",
  startsAt: at("2026-10-01T00:30:00Z"),
  neighborhood: "East Cut",
  hosts: ["CodeRabbit"],
  rsvpUrl: "https://lu.ma/event/evt-effect",
  curation: { kind: "ours" },
  ...overrides,
});

const photo = (name: string, width = 1600, height = 1200) => ({
  url: `https://media.allthings.dev/events/${name}.jpg`,
  alt: name,
  width,
  height,
  version: "1767323045",
});

const view = (overrides: Partial<HomeView> = {}): HomeView => ({
  next: evening(),
  afterThat: [],
  recently: [
    evening({
      slug: "2026-09-15-agent-setups",
      name: "All Things Agent Setups",
      topic: "agent setups",
      status: "past",
      startsAt: at("2026-09-16T00:30:00Z"),
      neighborhood: "FiDi",
      hosts: [],
    }),
  ],
  photos: [photo("a"), photo("b"), photo("c")],
  ...overrides,
});

/**
 * The home page for `home`, in the system's mode, linking original photos
 * and without portraits unless `options` say otherwise.
 */
const render = (
  home: HomeView,
  options: Partial<Pick<HomeProps, "theme" | "portraits" | "images">> = {},
) =>
  homePage({
    home,
    origin: "https://allthingsweb.dev",
    theme: undefined,
    portraits: new Map(),
    images: "originals",
    ...options,
  });

describe("the home page", () => {
  test("hides After that when nothing else is announced", () => {
    const html = render(view());
    expect(html).not.toContain("After that");
    expect(html).toContain('<div class="lists">');
  });

  test("calls a live evening's time now", () => {
    expect(render(view({ next: evening({ status: "live" }) }))).toContain(
      ">Now · Wed Sep 30 · 5:30 PM</time>",
    );
    expect(render(view())).toContain(">Next · Wed Sep 30 · 5:30 PM</time>");
  });

  test("sends I'm in to the event page when it has no Luma page", () => {
    const html = render(view({ next: evening({ rsvpUrl: null }) }));
    expect(html).toContain(
      '<a class="button" href="/2026-09-30-all-things-effect">I’m in<span aria-hidden="true">→</span></a>',
    );
    expect(html).not.toContain("on Luma");
  });

  test("says only what is known on the label line", () => {
    expect(render(view({ next: evening({ hosts: [] }) }))).toContain(
      '<p class="hero-label">East Cut</p>',
    );
    expect(
      render(
        view({ next: evening({ neighborhood: null, hosts: ["A", "B"] }) }),
      ),
    ).toContain('<p class="hero-label">A &amp; B</p>');
    expect(
      render(view({ next: evening({ neighborhood: null, hosts: [] }) })),
    ).not.toContain("hero-label");
  });

  test("sets a name that isn't a topic as written, smaller, with the cursor", () => {
    const html = render(
      view({
        next: evening({
          name: "TypeScript AI: The official conference after-party",
          topic: undefined,
        }),
      }),
    );
    expect(html).toContain(
      '<h1 id="next" class="hero-name lockup-s"><span>TypeScript AI: The official conference after-party</span><span class="at-cursor" aria-hidden="true">_</span></h1>',
    );
  });

  test("lays out as many photos as there are, and none without them", () => {
    expect(render(view({ photos: [] }))).not.toContain("mosaic");
    expect(render(view({ photos: [] }))).toContain('<section class="hero" ');
    expect(render(view({ photos: [photo("a")] }))).toContain(
      '<div class="mosaic tiles-1">',
    );
    expect(render(view({ photos: [photo("a"), photo("b")] }))).toContain(
      '<div class="mosaic tiles-2">',
    );
  });

  test("leaves out Recently when nothing has happened yet", async () => {
    const html = render(view({ recently: [] }));
    expect(html).not.toContain("Recently");
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("escapes what it prints", () => {
    const html = render(
      view({
        next: evening({
          name: "<script>alert(1)</script>",
          topic: undefined,
          hosts: ['"Acme" & <Co>'],
        }),
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;Acme&quot; &amp; &lt;Co&gt;");
  });

  test("sets the two sentences in the lead role", () => {
    expect(render(view())).toContain(
      '<div class="pitch at-type-lead"><p>Evenings for people who build software.</p><p class="pitch-place">In the neighborhoods of San Francisco.</p></div>',
    );
  });

  test("signs off with each host's portrait by profile id, else the blank avatar", () => {
    const html = render(view(), {
      portraits: new Map([[hosts[1].profileId, photo("andre")]]),
    });
    const sources = [
      ...(
        /<span class="portraits">(.*?)<\/span>/.exec(html)?.[1] ?? ""
      ).matchAll(/<img src="([^"]+)"/g),
    ].map(([, src]) => src);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatch(/^\/assets\/avatar\.[0-9a-f]{16}\.svg$/);
    expect(sources[1]).toBe(photo("andre").url);
  });

  test("renders the visitor's mode and marks it current in the switch", () => {
    const html = render(view(), { theme: "dark" });
    expect(html).toStartWith(
      '<!doctype html><html lang="en" data-theme="dark">',
    );
    expect(html).toContain(
      '<button type="button" popovertarget="mode-choices" aria-label="mode: night">',
    );
    expect(html).toMatch(
      /<a href="\?theme=dark" rel="nofollow" aria-current="true"><svg[^]*?<\/svg><span>night<\/span><\/a>/,
    );
    // The mode's choice alone: home is no section of the header.
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  test.each([
    ["one upcoming", view()],
    ["nothing ahead", view({ next: undefined })],
    ["no photos", view({ photos: [] })],
    ["after that", view({ afterThat: [evening({ slug: "later" })] })],
  ])("is valid HTML: %s", async (_, home) => {
    expect(await htmlProblems(render(home))).toEqual([]);
  });
});

describe("the home page's photos as variants", () => {
  const variants = (home: HomeView, portraits = new Map()) =>
    render(home, { images: "variants", portraits });
  const tiles = (html: string) =>
    /<div class="mosaic[^"]*">(.*?)<\/div>/
      .exec(html)?.[1]
      ?.match(/<picture>.*?<\/picture>/g) ?? [];
  const srcset = (path: string, upTo: number) =>
    [240, 360, 480, 720, 960, 1200]
      .filter((width) => width <= upTo)
      .map((width) => `/img/${width}/${path} ${width}w`)
      .join(", ");
  const wide =
    "(max-width: 767.98px) 91vw, (max-width: 1439.98px) calc(30.33vw - 16px), 421px";
  const half =
    "(max-width: 767.98px) calc(45.5vw - 6px), (max-width: 1439.98px) calc(15.17vw - 14px), 205px";

  test("offers each photo in AVIF, WebP and JPEG at every width it has, at its own size and with its alt", () => {
    const [first] = tiles(variants(view({ photos: [photo("a", 1024, 768)] })));
    const of = (format: string) => `${format}/1767323045/events/a.jpg`;
    expect(first).toBe(
      [
        "<picture>",
        `<source type="image/avif" srcset="${srcset(of("avif"), 1024)}" sizes="${wide}"/>`,
        `<source type="image/webp" srcset="${srcset(of("webp"), 1024)}" sizes="${wide}"/>`,
        `<img src="/img/480/${of("jpeg")}" srcset="${srcset(of("jpeg"), 1024)}" sizes="${wide}" alt="a" width="1024" height="768" loading="lazy" decoding="async"/>`,
        "</picture>",
      ].join(""),
    );
  });

  test("sizes the first tile wide and the others half, but for two, which are both wide", () => {
    const sizes = (html: string) =>
      tiles(html).map((tile) => /<img [^>]*sizes="([^"]+)"/.exec(tile)?.[1]);
    expect(sizes(variants(view()))).toEqual([wide, half, half]);
    expect(sizes(variants(view({ photos: [photo("a"), photo("b")] })))).toEqual(
      [wide, wide],
    );
  });

  test("offers a photo narrower than every width once, at its own width", () => {
    const [tile] = tiles(variants(view({ photos: [photo("a", 200, 150)] })));
    expect(tile).toContain(
      'srcset="/img/240/avif/1767323045/events/a.jpg 200w"',
    );
    expect(tile).toContain('src="/img/240/jpeg/1767323045/events/a.jpg"');
  });

  test("leaves out a photo it can't make variants of, and lays out the rest", () => {
    const html = variants(
      view({
        photos: [
          photo("a"),
          { ...photo("b"), url: "https://elsewhere.example/b.jpg" },
          { ...photo("c"), url: "https://media.allthings.dev/events/c.svg" },
        ],
      }),
    );
    expect(html).toContain('<div class="mosaic tiles-1">');
    expect(html).not.toContain("elsewhere.example");
    expect(html).not.toContain("c.svg");
    expect(
      variants(view({ photos: [{ ...photo("a"), url: "x" }] })),
    ).not.toContain("mosaic");
  });

  test("encodes each segment of a key, as the media origin's URLs do", () => {
    const [tile] = tiles(
      variants(
        view({
          photos: [
            {
              ...photo("a"),
              url: "https://media.allthings.dev/profiles/erik-pe%C3%B1a.png",
            },
          ],
        }),
      ),
    );
    expect(tile).toContain(
      'src="/img/480/jpeg/1767323045/profiles/erik-pe%C3%B1a.png"',
    );
  });

  test("signs off with each host's portrait at 36 and 72 pixels, cropped square", () => {
    const html = variants(
      view(),
      new Map([[hosts[0].profileId, photo("erik", 2160, 2160)]]),
    );
    const footer = /<span class="portraits">(.*?)<\/span>/.exec(html)?.[1];
    const squares = (format: string) =>
      `/img/36x36/${format}/1767323045/events/erik.jpg 1x, /img/72x72/${format}/1767323045/events/erik.jpg 2x`;
    expect(footer).toStartWith(
      [
        "<picture>",
        `<source type="image/avif" srcset="${squares("avif")}"/>`,
        `<source type="image/webp" srcset="${squares("webp")}"/>`,
        `<img src="/img/36x36/jpeg/1767323045/events/erik.jpg" srcset="${squares("jpeg")}" alt="" width="36" height="36" loading="lazy" decoding="async" fetchpriority="low"/>`,
        "</picture>",
        '<img src="/assets/avatar.',
      ].join(""),
    );
  });

  test("loads nothing from the media origin", () => {
    const html = variants(
      view(),
      new Map([[hosts[0].profileId, photo("erik", 2160, 2160)]]),
    );
    expect(html).not.toContain("media.allthings.dev");
  });

  test.each([
    ["three photos", view()],
    ["two photos", view({ photos: [photo("a"), photo("b")] })],
    ["a narrow photo", view({ photos: [photo("a", 100, 100)] })],
  ])("is valid HTML: %s", async (_, home) => {
    expect(
      await htmlProblems(
        variants(home, new Map([[hosts[1].profileId, photo("andre")]])),
      ),
    ).toEqual([]);
  });
});

describe("lockupSize", () => {
  test.each([
    ["effect", "l"],
    ["react native", "m"],
    ["typescript ai demo day", "m"],
    // Exactly as long as "all things/", then longer.
    ["observables", "l"],
    ["observability", "m"],
  ] as const)("at/%s is set %s", (topic, size) => {
    expect(lockupSize(evening({ topic }))).toBe(size);
  });

  test("a name without a topic is set small", () => {
    expect(lockupSize(evening({ topic: undefined }))).toBe("s");
  });
});

describe("hostNames", () => {
  test.each([
    [[], ""],
    [["CodeRabbit"], "CodeRabbit"],
    [["Convex", "Clerk"], "Convex & Clerk"],
    [
      ["Mux", "Strapi", "BigCommerce", "Neon", "Inngest"],
      "Mux, Strapi, BigCommerce, Neon & Inngest",
    ],
  ])("%j reads %j", (names, text) => {
    expect(hostNames(names)).toBe(text);
  });
});
