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
  ...overrides,
});

const photo = (name: string) => ({
  url: `https://media.allthings.dev/events/${name}.jpg`,
  alt: name,
  width: 1600,
  height: 1200,
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

/** The home page for `home`, in the system's mode and without portraits unless `options` say otherwise. */
const render = (
  home: HomeView,
  options: Partial<Pick<HomeProps, "theme" | "portraits">> = {},
) =>
  homePage({
    home,
    origin: "https://allthingsweb.dev",
    theme: undefined,
    portraits: new Map(),
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
      '<a class="button" href="https://allthingsweb.dev/2026-09-30-all-things-effect">I’m in<span aria-hidden="true">→</span></a>',
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
      '<a href="?theme=dark" rel="nofollow" aria-current="true">night</a>',
    );
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
