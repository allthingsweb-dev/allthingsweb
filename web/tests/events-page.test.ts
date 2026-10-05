import { describe, expect, test } from "bun:test";
import type { EveningsView } from "allthings-core/src/evenings.ts";
import type { Evening } from "allthings-core/src/home.ts";
import { DateTime } from "effect";
import { discord, lumaCalendar } from "../src/links.ts";
import { byYear, eventsPage } from "../src/pages/events.tsx";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/** The evenings index as a pure function of fixed data. */

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
  ...overrides,
});

const origin = "https://allthingsweb.dev";

const render = (evenings: EveningsView) =>
  eventsPage({
    evenings,
    origin,
    theme: undefined,
    portraits: new Map(),
    images: "originals",
  });

/** The list section headed `id`, or "" when the page has none. */
function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start === -1
    ? ""
    : html.slice(start, html.indexOf("</section>", start));
}

const rows = (html: string) =>
  [...html.matchAll(/<li>[\s\S]*?<\/li>/g)].map(([row]) => row);

const view: EveningsView = {
  ahead: [
    evening("live-now", "2026-10-03T01:00:00Z", { status: "live" }),
    evening("next-month", "2026-11-06T02:00:00Z", {
      status: "upcoming",
      name: "TypeScript AI: The official conference after-party",
      topic: undefined,
      neighborhood: null,
    }),
  ],
  past: [
    evening("2026-03-07-effect", "2026-03-08T07:30:00Z"),
    // 9 PM on December 31 in San Francisco, already 2025 in UTC.
    evening("2024-12-31-new-years-eve", "2025-01-01T05:00:00Z", {
      topic: "new years eve",
      neighborhood: "Mission",
    }),
    evening("2024-06-01-react", "2024-06-02T00:00:00Z", { topic: "react" }),
  ],
};

describe("byYear", () => {
  test("groups evenings by the year they happened in, in San Francisco, keeping their order", () => {
    expect(
      byYear(view.past).map(({ year, evenings }) => [
        year,
        evenings.map((e) => e.slug),
      ]),
    ).toEqual([
      [2026, ["2026-03-07-effect"]],
      [2024, ["2024-12-31-new-years-eve", "2024-06-01-react"]],
    ]);
  });

  test("has no years without evenings", () => {
    expect(byYear([])).toEqual([]);
  });
});

describe("the evenings index", () => {
  test("lists the evenings ahead first, in the order given, with the cursor", () => {
    const html = render(view);
    const upcoming = section(html, "upcoming");
    expect(upcoming).toContain(">Upcoming</h2>");
    const [live, next, ...more] = rows(upcoming);
    expect(more).toEqual([]);
    expect(live).toContain(`href="${origin}/live-now"`);
    expect(live).toContain(
      'at<span class="slash">/</span><span>effect</span><span class="at-cursor" aria-hidden="true">_</span>',
    );
    expect(next).toContain(
      '<span>TypeScript AI: The official conference after-party</span><span class="at-cursor" aria-hidden="true">_</span>',
    );
    // A row says only what is known: no neighborhood, no place.
    expect(next).not.toContain('class="place');
    expect(html.indexOf('id="upcoming"')).toBeLessThan(
      html.indexOf('id="evenings-2026"'),
    );
  });

  test("lists past evenings under their year, latest year first, without the cursor", () => {
    const html = render(view);
    expect(html.match(/<h2 [^>]*>[^<]*<\/h2>/g)).toEqual([
      '<h2 id="upcoming" class="list-title at-type-meta">Upcoming</h2>',
      '<h2 id="evenings-2026" class="list-title at-type-meta">2026</h2>',
      '<h2 id="evenings-2024" class="list-title at-type-meta">2024</h2>',
    ]);
    const y2024 = rows(section(html, "evenings-2024"));
    expect(y2024).toHaveLength(2);
    expect(y2024[0]).toContain(`href="${origin}/2024-12-31-new-years-eve"`);
    expect(y2024[0]).toContain(
      'datetime="2025-01-01T05:00:00.000Z">12.31.24</time>',
    );
    expect(y2024[0]).toContain(
      '<span class="place at-type-list-place">Mission</span>',
    );
    for (const row of [...y2024, ...rows(section(html, "evenings-2026"))]) {
      expect(row).not.toContain("at-cursor");
    }
  });

  test("leaves out Upcoming when nothing is announced", async () => {
    const html = render({ ahead: [], past: view.past });
    expect(html).not.toContain("Upcoming");
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("offers Luma and Discord as the foundations word them", () => {
    const html = render(view);
    expect(html).toContain(
      `<p class="list-links"><a href="${lumaCalendar}">subscribe on luma</a> · <a href="${discord}">talk between evenings <span aria-hidden="true">→</span> discord</a></p>`,
    );
  });

  test("has one h1 and headings in order", () => {
    const levels = headingLevels(render(view));
    expect(levels).toEqual([1, 2, 2, 2]);
    expect(render(view)).toContain(
      '<h1 class="lockup at-type-event-lockup">every evening</h1>',
    );
  });

  test("escapes what it prints and encodes slugs", () => {
    const html = render({
      ahead: [],
      past: [
        evening("café night", "2025-12-03T02:00:00Z", {
          name: "<script>alert(1)</script>",
          topic: undefined,
          neighborhood: '"Acme" & <Co>',
        }),
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;Acme&quot; &amp; &lt;Co&gt;");
    expect(html).toContain(`href="${origin}/caf%C3%A9%20night"`);
  });

  test.each([
    ["everything", view],
    ["nothing at all", { ahead: [], past: [] }],
    ["only ahead", { ahead: view.ahead, past: [] }],
  ])("is valid HTML: %s", async (_, evenings) => {
    expect(await htmlProblems(render(evenings))).toEqual([]);
  });
});
