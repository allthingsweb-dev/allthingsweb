import { describe, expect, test } from "bun:test";
import { type Format, quality } from "../src/images/variants.ts";
import type {
  CommunityView,
  HeldEvening,
} from "allthings-core/src/community.ts";
import type { Evening, HomeView } from "allthings-core/src/home.ts";
import { DateTime } from "effect";
import { hosts } from "../src/links.ts";
import {
  type HomeProps,
  homePage,
  hostNames,
  lockupSize,
} from "../src/pages/home.tsx";
import { clockTime, day, simpleDate } from "../src/pages/time.ts";
import { htmlProblems, twoDigitYears } from "./support/pages.ts";

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
    ["2026-10-01T00:30:00Z", "2026.09.30", "Wed Sep 30", "5:30 PM"],
    // Spring forward: 1:59 AM PST, then 3:00 AM PDT a minute later.
    ["2026-03-08T09:59:00Z", "2026.03.08", "Sun Mar 8", "1:59 AM"],
    ["2026-03-08T10:00:00Z", "2026.03.08", "Sun Mar 8", "3:00 AM"],
    // Before the change, the evening of the 7th is the 8th in UTC.
    ["2026-03-08T07:30:00Z", "2026.03.07", "Sat Mar 7", "11:30 PM"],
    // Fall back: 1:30 AM happens twice, an hour apart.
    ["2025-11-02T08:30:00Z", "2025.11.02", "Sun Nov 2", "1:30 AM"],
    ["2025-11-02T09:30:00Z", "2025.11.02", "Sun Nov 2", "1:30 AM"],
    ["2025-11-03T02:00:00Z", "2025.11.02", "Sun Nov 2", "6:00 PM"],
    // Midnight and noon.
    ["2026-01-01T08:00:00Z", "2026.01.01", "Thu Jan 1", "12:00 AM"],
    ["2026-07-04T19:05:00Z", "2026.07.04", "Sat Jul 4", "12:05 PM"],
  ])("%s is %s, %s, %s", (iso, date, weekday, time) => {
    expect(simpleDate(at(iso))).toBe(date);
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
        const [month, dayOfMonth, fullYear] = oracle(date, {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        }).split("/");
        expect(simpleDate(instant)).toBe(`${fullYear}.${month}.${dayOfMonth}`);
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

describe("simple dates", () => {
  test.each([
    // A calendar day has no zone: it is dated as it is, never shifted.
    ["2024-07-30", "2024.07.30"],
    ["2026-01-01", "2026.01.01"],
    ["2025-12-31", "2025.12.31"],
    ["0999-03-04", "0999.03.04"],
    // Leap days: every fourth year, but not a century unless a fourth one.
    ["2024-02-29", "2024.02.29"],
    ["2000-02-29", "2000.02.29"],
  ])("the day %s is %s", (calendarDay, date) => {
    expect(simpleDate(calendarDay)).toBe(date);
  });

  test("an instant and its day in San Francisco read the same", () => {
    expect(simpleDate(at("2026-10-01T00:30:00Z"))).toBe(
      simpleDate("2026-09-30"),
    );
  });

  test("refuse what isn't a YYYY-MM-DD day on the calendar", () => {
    for (const notADay of [
      "09.30.26",
      "2026-9-30",
      "2026-09-30T00:00:00Z",
      "2026-02-29",
      "1900-02-29",
      "2026-02-30",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
    ]) {
      expect(() => simpleDate(notADay)).toThrow(RangeError);
    }
  });

  test("are the one format the drift check passes", () => {
    expect(twoDigitYears(`<time>${simpleDate("2026-09-30")}</time>`)).toEqual(
      [],
    );
  });
});

describe("the drift check", () => {
  test("finds dates with two-digit years in what a page shows", () => {
    expect(
      twoDigitYears(
        "<p>09.30.26</p><p>9/30/26 &amp; 30-09-26</p><p>Sep &#39;26, Fall ’25</p>",
      ),
    ).toEqual(["09.30.26", "9/30/26", "30-09-26", "'26", "’25"]);
  });

  test("passes simple dates, times, versions and what isn't shown", () => {
    expect(
      twoDigitYears(
        [
          "<time datetime='2026-09-30'>2026.09.30</time>",
          "<p>5:30–8:30 PM · Wed Sep 30, 2026 · 2026–2027</p>",
          "<p>v1.2.3 · 10.4.2026 · 1990s · it's 25 · '90s</p>",
          '<svg><path d="M12.5.30"/></svg><style>a{b:1.2.30}</style>',
          '<img alt="" src="/x.09.30.26.png"/>',
        ].join(""),
      ),
    ).toEqual([]);
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
  ...overrides,
});

/** A photo on the wall, of the evening at `slug`. */
/** An evening held, with its photo `name`. */
const walled = (
  name: string,
  slug = "2026-09-15-agent-setups",
  width?: number,
  height?: number,
): HeldEvening => ({
  slug,
  name: "All Things Agent Setups",
  topic: "agent setups",
  startsAt: at("2026-09-16T00:30:00Z"),
  photo: photo(name, width, height),
});

const community = (overrides: Partial<CommunityView> = {}): CommunityView => ({
  tally: { evenings: 34, guests: 6827, speakers: 49, hostingCompanies: 18 },
  evenings: [walled("a"), walled("b"), walled("c")],
  wall: [],
  faces: [],
  ...overrides,
});

/** The community with `evenings` alone held. */
const wallOf = (...evenings: ReadonlyArray<HeldEvening>) =>
  community({ evenings });

/**
 * The home page for `home`, in the system's mode, linking original photos
 * and without portraits unless `options` say otherwise.
 */
const render = (
  home: HomeView,
  options: Partial<
    Pick<HomeProps, "community" | "theme" | "portraits" | "images">
  > = {},
) =>
  homePage({
    home,
    community: community(),
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

  test("names each row's neighborhood to a screen reader, under no column label of its own", () => {
    // The two sentences beside the lists say the places are neighborhoods;
    // Recently's line holds its links where /events labels the column.
    const html = render(view({ afterThat: [evening({ slug: "later" })] }));
    expect(html).toContain(
      '<span class="place at-type-list-place"><span class="visually-hidden">, neighborhood: </span><span>East Cut</span></span>',
    );
    expect(html).toContain(
      '<span class="place at-type-list-place"><span class="visually-hidden">, neighborhood: </span><span>FiDi</span></span>',
    );
    expect(html).not.toContain("list-column");
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

  test("cuts a photo of each evening on the slash beside the hero, dated and leading to it", () => {
    const html = render(view());
    expect(html).toContain(
      '<section class="hero slash-cut" aria-labelledby="next"><div class="hero-text">',
    );
    expect(html).toContain(
      '<li><a href="/2026-09-15-agent-setups"><span class="cut"><img src="https://media.allthings.dev/events/a.jpg" alt="a"',
    );
    expect(
      html.match(/<li><a href="\/2026-09-15-agent-setups">/g),
    ).toHaveLength(3);
    expect(html).toContain(
      '<time class="cut-date at-type-meta" datetime="2026-09-16T00:30:00.000Z">2026.09.15</time>',
    );
  });

  test("shows at most 24 photos, and no grid without them", () => {
    const many = wallOf(
      ...Array.from({ length: 30 }, (_, index) => walled(`p${index}`)),
    );
    expect(
      /<ul class="slash-grid slash-grid-dated">(.*?)<\/ul>/
        .exec(render(view(), { community: many }))?.[1]
        ?.match(/<li>/g),
    ).toHaveLength(24);
    const none = render(view(), { community: wallOf() });
    expect(none).not.toContain("slash-grid");
    expect(none).toContain('<section class="hero" aria-labelledby="next">');
  });

  test("sets the tally under the hero as a band, leaving out a zero", () => {
    const html = render(view());
    expect(html).toContain(
      '</section><section class="figures figures-band" aria-label="So far"><dl><div><dt class="at-type-meta">evenings</dt><dd>34</dd></div>',
    );
    expect(html).toContain("<dd>6,827</dd>");
    const fresh = render(view(), {
      community: community({
        tally: { evenings: 3, guests: 0, speakers: 2, hostingCompanies: 1 },
      }),
    });
    expect(fresh).not.toContain("said “I’m in”");
    expect(
      render(view(), {
        community: community({
          tally: { evenings: 0, guests: 0, speakers: 0, hostingCompanies: 0 },
        }),
      }),
    ).not.toContain("figures");
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

  test("sets the two sentences in the statement role", () => {
    expect(render(view())).toContain(
      '<div class="pitch at-type-statement"><p>Evenings for people who build software.</p><p class="pitch-place">In the neighborhoods of San Francisco.</p></div>',
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
    // The mode's choice, and home in the header: nothing else.
    expect(html.match(/aria-current/g)).toHaveLength(2);
  });

  test("names home first in the header, marked as the current page", () => {
    expect(render(view())).toContain(
      '<nav class="site-nav at-type-meta" aria-label="site"><ul><li><a href="/" aria-current="page">home</a></li><li><a href="/events">events</a></li><li><a href="/people">people</a></li><li><a href="/about">about</a></li></ul></nav>',
    );
  });

  test.each([
    ["one upcoming", view(), community()],
    ["nothing ahead", view({ next: undefined }), community()],
    ["no photos", view(), wallOf()],
    ["nothing ahead, no photos", view({ next: undefined }), wallOf()],
    [
      "after that",
      view({ afterThat: [evening({ slug: "later" })] }),
      community(),
    ],
  ])("is valid HTML: %s", async (_, home, walls) => {
    expect(await htmlProblems(render(home, { community: walls }))).toEqual([]);
  });
});

describe("the home page's photos as variants", () => {
  const variants = (
    home: HomeView,
    portraits = new Map(),
    walls: CommunityView = community(),
  ) => render(home, { images: "variants", portraits, community: walls });
  const tiles = (html: string) =>
    /<ul class="slash-grid slash-grid-dated">(.*?)<\/ul>/
      .exec(html)?.[1]
      ?.match(/<picture>.*?<\/picture>/g) ?? [];
  const srcset = (path: string, upTo: number) =>
    [240, 360, 480]
      .filter((width) => width <= upTo)
      .map((width) => `/img/${width}/${path} ${width}w`)
      .join(", ");
  const sizes = "(max-width: 767.98px) 26vw, 10vw";

  test("offers each photo in AVIF, WebP and JPEG up to 480 wide, at its own size and with its alt", () => {
    const [first] = tiles(
      variants(view(), new Map(), wallOf(walled("a", undefined, 1024, 768))),
    );
    const of = (format: Format) =>
      `${format}/1767323045-q${quality[format]}/events/a.jpg`;
    expect(first).toBe(
      [
        "<picture>",
        `<source type="image/avif" srcset="${srcset(of("avif"), 1024)}" sizes="${sizes}"/>`,
        `<source type="image/webp" srcset="${srcset(of("webp"), 1024)}" sizes="${sizes}"/>`,
        `<img src="/img/480/${of("jpeg")}" srcset="${srcset(of("jpeg"), 1024)}" sizes="${sizes}" alt="a" width="1024" height="768" decoding="async" fetchpriority="high"/>`,
        "</picture>",
      ].join(""),
    );
  });

  test("loads the first row first and the rest of the first two at once", () => {
    const html = variants(
      view(),
      new Map(),
      wallOf(...Array.from({ length: 24 }, (_, index) => walled(`p${index}`))),
    );
    expect(html.match(/fetchpriority="high"/g)).toHaveLength(6);
    expect(
      tiles(html).filter((tile) => tile.includes('loading="lazy"')),
    ).toHaveLength(12);
  });

  test("offers a photo narrower than every width once, at its own width", () => {
    const [tile] = tiles(
      variants(view(), new Map(), wallOf(walled("a", undefined, 200, 150))),
    );
    expect(tile).toContain(
      'srcset="/img/240/avif/1767323045-q70/events/a.jpg 200w"',
    );
    expect(tile).toContain('src="/img/240/jpeg/1767323045-q80/events/a.jpg"');
  });

  test("leaves out a photo it can't make variants of, and lays out the rest", () => {
    const html = variants(
      view(),
      new Map(),
      wallOf(
        walled("a"),
        {
          ...walled("b"),
          photo: { ...photo("b"), url: "https://elsewhere.example/b.jpg" },
        },
        {
          ...walled("c"),
          photo: {
            ...photo("c"),
            url: "https://media.allthings.dev/events/c.svg",
          },
        },
      ),
    );
    expect(tiles(html)).toHaveLength(1);
    expect(html).not.toContain("elsewhere.example");
    expect(html).not.toContain("c.svg");
    expect(
      variants(
        view(),
        new Map(),
        wallOf({ ...walled("a"), photo: { ...photo("a"), url: "x" } }),
      ),
    ).not.toContain("slash-grid");
  });

  test("encodes each segment of a key, as the media origin's URLs do", () => {
    const [tile] = tiles(
      variants(
        view(),
        new Map(),
        wallOf({
          ...walled("a"),
          photo: {
            ...photo("a"),
            url: "https://media.allthings.dev/profiles/erik-pe%C3%B1a.png",
          },
        }),
      ),
    );
    expect(tile).toContain(
      'src="/img/480/jpeg/1767323045-q80/profiles/erik-pe%C3%B1a.png"',
    );
  });

  test("signs off with each host's portrait at 36 and 72 pixels, cropped square", () => {
    const html = variants(
      view(),
      new Map([[hosts[0].profileId, photo("erik", 2160, 2160)]]),
    );
    const footer = /<span class="portraits">(.*?)<\/span>/.exec(html)?.[1];
    const squares = (format: Format) =>
      `/img/36x36/${format}/1767323045-q${quality[format]}/events/erik.jpg 1x, /img/72x72/${format}/1767323045-q${quality[format]}/events/erik.jpg 2x`;
    expect(footer).toStartWith(
      [
        "<picture>",
        `<source type="image/avif" srcset="${squares("avif")}"/>`,
        `<source type="image/webp" srcset="${squares("webp")}"/>`,
        `<img src="/img/36x36/jpeg/1767323045-q80/events/erik.jpg" srcset="${squares("jpeg")}" alt="Erik" width="36" height="36" loading="lazy" decoding="async" fetchpriority="low"/>`,
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
    ["three photos", community()],
    ["two photos", wallOf(walled("a"), walled("b"))],
    ["a narrow photo", wallOf(walled("a", undefined, 100, 100))],
  ])("is valid HTML: %s", async (_, walls) => {
    expect(
      await htmlProblems(
        variants(
          view(),
          new Map([[hosts[1].profileId, photo("andre")]]),
          walls,
        ),
      ),
    ).toEqual([]);
  });
});

describe("lockupSize", () => {
  test.each([
    ["effect", "l"],
    ["react native", "m"],
    ["typescript ai demo day", "m"],
    // Exactly as long as "allthings/", then longer.
    ["typescript", "l"],
    ["observables", "m"],
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
