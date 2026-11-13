import { describe, expect, test } from "bun:test";
import { escapeHtml } from "@kitajs/html";
import type { Letter } from "allthings-core/src/letter.ts";
import { issuePath, letterPath, lumaCalendar } from "../src/links.ts";
import { sections } from "../src/pages/document.tsx";
import { issuePage, letterIndexPage } from "../src/pages/letter.tsx";
import { sitemapXml, sitePages } from "../src/seo/sitemap.ts";
import { axeProblems } from "./support/a11y.ts";
import {
  gzipped,
  headingLevels,
  htmlBudget,
  htmlProblems,
} from "./support/pages.ts";

/**
 * The letter's archive (pages/letter.tsx) as pure functions of the issues
 * Erik approved, and the rule that nothing else in the Worker reads them.
 */

const origin = "https://allthings.dev";

const page = {
  origin,
  theme: undefined,
  portraits: new Map(),
  images: "originals",
} as const;

const december: Letter = {
  month: "2026-12",
  title: "Miami, Portland, Raleigh",
  happenings: [
    {
      name: "React Miami",
      text: "Two days of talks, right after [AI Engineer Miami](https://www.ai.engineer/miami/2027).",
      source: { _tag: "guide", id: "react-miami" },
    },
  ],
  evenings: [
    {
      name: "allthings/effect",
      text: "Effect's people, on our stage.",
      source: { _tag: "event", slug: "effect" },
    },
  ],
  closing: "Thank you for coming, & for staying <late>.",
  approved: { month: "2026-12", on: "2026-12-01", token: "0123456789abcdef" },
};

const january: Letter = {
  month: "2027-01",
  title: "A January title",
  closing: "A closing.",
  approved: { month: "2027-01", on: "2027-01-05", token: "fedcba9876543210" },
};

describe("/letter", () => {
  test("says there is none yet until Erik approves one", () => {
    const html = letterIndexPage({ letters: [], ...page });
    expect(html).toContain("The first one hasn't gone out yet.");
    expect(html).not.toContain(`href="${letterPath}/`);
    expect(html).toContain(`<a href="${lumaCalendar}">`);
  });

  test("lists the issues it is given, in their order, each at its month", () => {
    const html = letterIndexPage({ letters: [january, december], ...page });
    const at = (text: string) => html.indexOf(text);
    expect(at(issuePath("2027-01"))).toBeGreaterThan(-1);
    expect(at(issuePath("2027-01"))).toBeLessThan(at(issuePath("2026-12")));
    expect(html).toContain(">2026.12</time>");
    expect(html).not.toContain("The first one");
  });

  test("is in the sitemap, not in the header", () => {
    expect(sitePages).toContain(letterPath);
    expect(sections.map((entry) => entry.path)).not.toContain(letterPath);
  });
});

describe("an issue's page", () => {
  const html = issuePage({ letter: december, ...page });

  test("reads in the letter's order: title, sections, closing, who wrote it", () => {
    const order = [
      "Miami, Portland, Raleigh",
      ">our next evenings</h2>",
      `<a href="${origin}/effect">allthings/effect</a>`,
      ">worth your time</h2>",
      `<a href="https://www.reactmiami.com/">React Miami</a>`,
      `<a href="https://www.ai.engineer/miami/2027">AI Engineer Miami</a>`,
      escapeHtml("Thank you for coming, & for staying <late>."),
      "written by claude · approved by erik",
      '<time datetime="2026-12-01">2026.12.01</time>',
    ].map((text) => html.indexOf(text));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(html).not.toContain(">new open source</h2>");
    expect(html).not.toContain("<late>");
  });

  test("is listed in the sitemap once published, after the years", () => {
    const xml = sitemapXml([], origin, [], [2026], ["2027-01", "2026-12"]);
    expect(xml).toContain(`<loc>${origin}${issuePath("2026-12")}</loc>`);
    expect(xml.indexOf("/year/2026")).toBeLessThan(
      xml.indexOf(issuePath("2027-01")),
    );
  });

  test("fits the first round trip", () => {
    expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
  });

  test("passes axe", async () => {
    expect(await axeProblems(html)).toEqual([]);
  });

  test.each([
    ["the system's mode", undefined],
    ["Paper", "light"],
    ["Night", "dark"],
  ] as const)(
    "is valid HTML with one h1 and headings in order, in %s",
    async (_, theme) => {
      for (const rendered of [
        issuePage({ letter: december, ...page, theme }),
        letterIndexPage({ letters: [december], ...page, theme }),
      ]) {
        expect(await htmlProblems(rendered)).toEqual([]);
        const levels = headingLevels(rendered);
        expect(levels.filter((level) => level === 1)).toHaveLength(1);
        for (const [index, level] of levels.entries()) {
          if (index > 0) {
            expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
          }
        }
      }
    },
  );
});

describe("drafts", () => {
  test("are read by nothing the Worker serves: every surface takes publishedLetters", async () => {
    const root = new URL("../src/", import.meta.url).pathname;
    const reads: Array<string> = [];
    for (const path of new Bun.Glob("**/*.{ts,tsx}").scanSync(root)) {
      const text = await Bun.file(`${root}${path}`).text();
      if (
        /\beveryIssue\b|\bissueFiles\b|\bpublishedOf\b|letters\/index|letters\/approvals/.test(
          text,
        )
      ) {
        reads.push(path);
      }
    }
    expect(reads).toEqual([]);
  });
});
