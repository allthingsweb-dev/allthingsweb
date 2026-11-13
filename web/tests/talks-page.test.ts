import { describe, expect, test } from "bun:test";
import type { Evening } from "allthings-core/src/home.ts";
import type { LibraryTalk } from "allthings-core/src/talks-library.ts";
import { DateTime } from "effect";
import { ogCards } from "../src/og/cards.ts";
import { talksByYear, talksPage } from "../src/pages/talks.tsx";
import {
  gzipped,
  headingLevels,
  htmlBudget,
  htmlProblems,
  twoDigitYears,
} from "./support/pages.ts";

/** The talks library as a pure function of fixed data. */

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
  hosts: [],
  rsvpUrl: null,
  curation: { kind: "ours" },
  ...overrides,
});

const effect = evening("effect", "2026-03-08T02:30:00Z");
// 9 PM on December 31 in San Francisco, already 2025 in UTC.
const newYears = evening("2024-12-31-new-years-eve", "2025-01-01T05:00:00Z", {
  name: "New Year's Eve",
  topic: "new years eve",
});

const talk = (
  title: string,
  on: Evening,
  overrides: Partial<LibraryTalk> = {},
): LibraryTalk => ({
  id: `talk-${title}`,
  title,
  format: "talk",
  speakers: [
    { id: "ada", slug: "ada-lovelace", name: "Ada Lovelace", role: "speaker" },
  ],
  evening: on,
  recordingUrl: null,
  ...overrides,
});

const talks: ReadonlyArray<LibraryTalk> = [
  talk("State of Effect 2026", effect, {
    speakers: [
      {
        id: "grace",
        slug: "grace-hopper",
        name: "Grace Hopper",
        role: "speaker",
      },
      {
        id: "ada",
        slug: "ada-lovelace",
        name: "Ada Lovelace",
        role: "speaker",
      },
    ],
    recordingUrl: "https://www.youtube.com/watch?v=abc123",
  }),
  talk("Typed errors", effect, {
    recordingUrl: "https://www.youtube.com/watch?v=abc123",
  }),
  talk("Countdown", newYears, { speakers: [] }),
];

const origin = "https://allthings.dev";

const render = (
  library: ReadonlyArray<LibraryTalk>,
  theme?: "light" | "dark",
) =>
  talksPage({
    talks: library,
    origin,
    theme,
    portraits: new Map(),
    images: "originals",
  });

/** The year's section headed `id`, or "" when the page has none. */
function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start === -1
    ? ""
    : html.slice(start, html.indexOf("</section>", start));
}

const rows = (html: string) =>
  [...html.matchAll(/<li><div class="talk">[\s\S]*?<\/li>/g)].map(
    ([row]) => row,
  );

describe("talksByYear", () => {
  test("groups talks by the year their evening was in, in San Francisco, keeping their order", () => {
    expect(
      talksByYear(talks).map(({ year, talks: inYear }) => [
        year,
        inYear.map((t) => t.title),
      ]),
    ).toEqual([
      [2026, ["State of Effect 2026", "Typed errors"]],
      [2024, ["Countdown"]],
    ]);
  });

  test("has no years without talks", () => {
    expect(talksByYear([])).toEqual([]);
  });
});

describe("the talks library", () => {
  test("is every talk, titled and described as a page that gathers others", () => {
    const html = render(talks);
    expect(html).toContain("<title>every talk · allthings/_</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://allthings.dev/talks"/>',
    );
    expect(html).toContain(
      `<meta property="og:image" content="${origin}${ogCards.talks.src}"/>`,
    );
    expect(html).toContain(
      '<h1 class="lockup at-type-event-lockup">every talk</h1>',
    );
    expect(html).toContain('<p class="at-type-meta">3 talks at 2 evenings</p>');
  });

  test("belongs to the evenings in the header, as an evening's page does", () => {
    expect(render(talks)).toContain(
      '<li><a href="/events" aria-current="page">events</a></li>',
    );
  });

  test("lists talks under their evening's year, latest year first, in the order given", () => {
    const html = render(talks);
    expect(html.match(/<h2 [^>]*>[^<]*<\/h2>/g)).toEqual([
      '<h2 id="talks-2026" class="list-title at-type-meta">2026</h2>',
      '<h2 id="talks-2024" class="list-title at-type-meta">2024</h2>',
    ]);
    const y2026 = rows(section(html, "talks-2026"));
    expect(y2026.map((row) => /talk-title">([^<]*)</.exec(row)?.[1])).toEqual([
      "State of Effect 2026",
      "Typed errors",
    ]);
    const [countdown, ...more] = rows(section(html, "talks-2024"));
    expect(more).toEqual([]);
    expect(countdown).toContain(
      'datetime="2025-01-01T05:00:00.000Z">2024.12.31</time>',
    );
  });

  test("names who gave each talk, each linking to their page, then its evening, linking to its page", () => {
    const [first] = rows(render(talks));
    expect(first).toContain(
      '<span class="talk-evening"><a href="/people/grace-hopper">Grace Hopper</a>, <a href="/people/ada-lovelace">Ada Lovelace</a><span class="talk-role at-type-meta"> · <a href="/effect">at<span class="slash">/</span><span>effect</span></a></span></span>',
    );
  });

  test("names only the evening of a talk without speakers", () => {
    const html = render(talks);
    expect(rows(section(html, "talks-2024"))[0]).toContain(
      '<span class="talk-evening"><span class="talk-role at-type-meta"><a href="/2024-12-31-new-years-eve">at<span class="slash">/</span><span>new years eve</span></a></span></span>',
    );
  });

  test("links the evening's recording under each of its talks, and nothing where it has none", () => {
    const html = render(talks);
    const recordings = [
      ...html.matchAll(/<a class="talk-video at-type-meta" href="([^"]+)">/g),
    ].map(([, href]) => href);
    expect(recordings).toEqual([
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/watch?v=abc123",
    ]);
    expect(html).toContain(
      '<span>recording</span><span class="visually-hidden"> of the evening with State of Effect 2026</span>',
    );
    expect(section(html, "talks-2024")).not.toContain("talk-video");
  });

  test("writes every date as a simple date, and no year in two digits", () => {
    const html = render(talks);
    expect(twoDigitYears(html)).toEqual([]);
    for (const [, date] of html.matchAll(/<time\b[^>]*>([^<]*)<\/time>/g)) {
      expect(date).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    }
  });

  test("says nothing it doesn't know before any talk is given", async () => {
    const html = render([]);
    expect(html).not.toContain("0 talks");
    expect(html).not.toContain('class="talks"');
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("escapes what it prints and encodes slugs", () => {
    const html = render([
      talk(
        "<script>alert(1)</script>",
        evening("café night", "2025-12-03T02:00:00Z", {
          name: '"Acme" & <Co>',
          topic: undefined,
        }),
        {
          speakers: [
            { id: "x", slug: "zoë", name: "<b>Zoë</b>", role: "speaker" },
          ],
        },
      ),
    ]);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;Acme&quot; &amp; &lt;Co&gt;");
    expect(html).toContain("&lt;b&gt;Zoë&lt;/b&gt;");
    expect(html).toContain('href="/caf%C3%A9%20night"');
    expect(html).toContain('href="/people/zo%C3%AB"');
  });

  test("stays within the page budget with a hundred and fifty talks", () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      talk(
        `Talk number ${i} about building software`,
        evening(`evening-${Math.floor(i / 3)}`, "2025-06-01T01:00:00Z"),
        { recordingUrl: "https://www.youtube.com/watch?v=abc123" },
      ),
    );
    expect(gzipped(render(many))).toBeLessThanOrEqual(htmlBudget);
  });

  test.each([
    ["the system's mode", undefined],
    ["Paper", "light"],
    ["Night", "dark"],
  ] as const)(
    "is valid HTML with one h1 and headings in order, in %s",
    async (_, theme) => {
      const html = render(talks, theme);
      expect(await htmlProblems(html)).toEqual([]);
      expect(headingLevels(html)).toEqual([1, 2, 2]);
    },
  );
});
