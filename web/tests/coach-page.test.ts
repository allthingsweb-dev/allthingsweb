import { describe, expect, test } from "bun:test";
import { goalLabels, rules } from "allthings-core/src/coaching.ts";
import { escapeHtml } from "@kitajs/html";
import { discord } from "../src/links.ts";
import { sections } from "../src/pages/document.tsx";
import { coachPage, coachPath } from "../src/pages/coach.tsx";
import { sitePages } from "../src/seo/sitemap.ts";
import {
  gzipped,
  headingLevels,
  htmlBudget,
  htmlProblems,
} from "./support/pages.ts";

/** /coach as a pure function: what good looks like, from core's coaching. */

const origin = "https://allthings.dev";

const render = (theme?: "light" | "dark") =>
  coachPage({ origin, theme, portraits: new Map(), images: "originals" });

describe("/coach", () => {
  test("says every rule's good and why, word for word, from core's coaching", () => {
    const html = render();
    for (const rule of rules) {
      expect(html).toContain(escapeHtml(rule.good));
      expect(html).toContain(escapeHtml(rule.why));
    }
    for (const label of Object.values(goalLabels)) {
      expect(html).toContain(escapeHtml(label));
    }
  });

  test("gives the open floor's slot and when to finish by", () => {
    const html = render();
    expect(html).toContain(
      "An open floor gives each speaker 3 minutes. The timer starts at your first words, and at 3:00 the screen switches to the timer",
    );
    expect(html).toContain("by 2:40 of 3:00");
  });

  test("points to coach_talk on the MCP server and says nothing is kept", () => {
    const html = render();
    expect(html).toContain("<code>coach_talk</code>");
    expect(html).toContain(`<code>${origin}/mcp</code>`);
    expect(html).toContain("Nothing you send is kept or logged.");
    expect(html).toContain(`<a href="${discord}">`);
    expect(html).not.toMatch(
      /<form|<input|<script(?! type="application\/ld\+json")/,
    );
  });

  test("is in the sitemap, not in the header", () => {
    expect(sitePages).toContain(coachPath);
    expect(sections.map((entry) => entry.path)).not.toContain(coachPath);
  });

  test("fits the first round trip", () => {
    expect(gzipped(render())).toBeLessThanOrEqual(htmlBudget);
  });

  test.each([
    ["the system's mode", undefined],
    ["Paper", "light"],
    ["Night", "dark"],
  ] as const)(
    "is valid HTML with one h1 and headings in order, in %s",
    async (_, theme) => {
      const html = render(theme);
      expect(await htmlProblems(html)).toEqual([]);
      const levels = headingLevels(html);
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      for (const [index, level] of levels.entries()) {
        if (index > 0) {
          expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
        }
      }
    },
  );
});
