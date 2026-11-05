import { describe, expect, test } from "bun:test";
import type { Now } from "allthings-core/src/now.ts";
import type {
  PeopleView,
  PersonPage,
} from "allthings-core/src/people-directory.ts";
import { personSlug } from "allthings-core/src/person-slug.ts";
import type { LabPage } from "../src/pages/lab/lab.tsx";
import { labRootPage } from "../src/pages/lab/labs.tsx";
import { nowLabPage } from "../src/pages/lab/now.tsx";
import { nowLabPath, nowLabPersonPath } from "../src/pages/lab/paths.ts";
import { personPage } from "../src/pages/person.tsx";
import { simpleDayOrMonth, simpleMonth } from "../src/pages/time.ts";
import { sitemapXml } from "../src/seo/sitemap.ts";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/**
 * What people do now (docs/now.md) on their pages, as pure functions of
 * fixed data: the Now section after the bio, every fact in its line a
 * link to its source, their latest work listed as talks elsewhere are, and
 * only where the page is asked to show it: /lab/now, until Erik's yes.
 */

const record: Now = {
  line: "Ada [writes compilers at AT&T](https://att.example/team) and [teaches them](https://school.example/ada).",
  links: [
    {
      title: "Compilers, <gently>",
      date: "2026-10-11",
      url: "https://www.youtube.com/watch?v=abc",
      kind: "talk",
    },
    {
      title: "A month of parsers",
      date: "2026-07",
      url: "https://ada.example/parsers",
      kind: "article",
    },
  ],
  checkedOn: "2026-11-02",
};

const person = (
  name: string,
  overrides: Partial<PersonPage> = {},
): PersonPage => ({
  id: name,
  slug: personSlug(name),
  name,
  title: "Engineer",
  bio: "Writes compilers.",
  links: { x: null, bluesky: null, linkedin: null },
  photo: null,
  parts: [],
  organizes: false,
  hosted: [],
  now: record,
  xPosts: null,
  ...overrides,
});

const page: LabPage = {
  origin: "https://allthings.dev",
  theme: undefined,
  portraits: new Map(),
  images: "originals",
};

const render = (
  who: PersonPage,
  look: { showNow?: boolean; noindex?: true } = {},
) => personPage({ person: who, elsewhere: [], ...page, ...look });

/** The section headed `id`, or "" when the page has none. */
const section = (html: string, id: string): string =>
  new RegExp(
    `<section class="about-part" aria-labelledby="${id}">[\\s\\S]*?</section>`,
  ).exec(html)?.[0] ?? "";

describe("simpleMonth", () => {
  test("writes a month as the site writes days, year first", () => {
    expect(simpleMonth("2026-11-02")).toBe("2026.11");
    expect(simpleMonth("2026-07")).toBe("2026.07");
    expect(simpleDayOrMonth("2026-07")).toBe("2026.07");
    expect(simpleDayOrMonth("2026-10-11")).toBe("2026.10.11");
    expect(() => simpleMonth("Nov 2026")).toThrow(RangeError);
  });
});

describe("the Now section", () => {
  test("follows the bio, says the month it was checked, and links every fact to its source", async () => {
    const html = render(person("Ada"), { showNow: true });
    expect(await htmlProblems(html)).toEqual([]);
    expect(html.indexOf('aria-labelledby="bio"')).toBeLessThan(
      html.indexOf('aria-labelledby="now"'),
    );
    const now = section(html, "now");
    expect(now).toContain(
      '<h2 id="now" class="at-type-meta">Now · as of 2026.11</h2>',
    );
    expect(now).toContain(
      '<p class="person-page-bio person-now"><span>Ada </span><a href="https://att.example/team">writes compilers at AT&amp;T</a><span> and </span><a href="https://school.example/ada">teaches them</a><span>.</span></p>',
    );
  });

  test("lists their latest work as talks elsewhere are: day or month, title, where and what", () => {
    const now = section(render(person("Ada"), { showNow: true }), "now");
    expect(now).toContain(
      '<li><a class="talk" href="https://www.youtube.com/watch?v=abc"><time class="date at-type-meta" datetime="2026-10-11">2026.10.11</time><span class="talk-title">Compilers, &lt;gently&gt;</span><span class="talk-evening"><span>youtube.com</span><span class="talk-role at-type-meta"> · talk</span></span></a></li>',
    );
    expect(now).toContain(
      '<time class="date at-type-meta" datetime="2026-07">2026.07</time><span class="talk-title">A month of parsers</span><span class="talk-evening"><span>ada.example</span><span class="talk-role at-type-meta"> · article</span>',
    );
  });

  test("has no list without links", () => {
    const now = section(
      render(person("Ada", { now: { ...record, links: [] } }), {
        showNow: true,
      }),
      "now",
    );
    expect(now).toContain("person-now");
    expect(now).not.toContain('<ul class="talks">');
  });

  test("stays off a page not asked to show it, and off anyone without a record", () => {
    expect(render(person("Ada"))).not.toContain('id="now"');
    expect(
      render(person("Ada", { now: null }), { showNow: true }),
    ).not.toContain('id="now"');
  });

  test("keeps the lab's copy of a page out of search", () => {
    expect(render(person("Ada"), { showNow: true, noindex: true })).toContain(
      '<meta name="robots" content="noindex, nofollow"/>',
    );
    expect(render(person("Ada"))).not.toContain('name="robots"');
  });
});

const view = (people: ReadonlyArray<PersonPage>): PeopleView => ({
  organizers: [person("Erik Thorelli", { now: null, organizes: true })],
  speakers: people,
  coHosts: [],
});

describe("/lab/now", () => {
  test("lists everyone with a record by name, each linking to their page in the lab, with its line as it reads", async () => {
    const html = nowLabPage(
      view([
        person("Grace Hopper"),
        person("Ada"),
        person("Linus", { now: null }),
      ]),
      page,
    );
    expect(await htmlProblems(html)).toEqual([]);
    expect(headingLevels(html)).toEqual([1]);
    expect(html.indexOf(`href="${nowLabPersonPath("ada")}"`)).toBeLessThan(
      html.indexOf(`href="${nowLabPersonPath("grace-hopper")}"`),
    );
    expect(html).not.toContain("/lab/now/linus");
    expect(html).not.toContain("/lab/now/erik-thorelli");
    expect(html).toContain(
      "Ada writes compilers at AT&amp;T and teaches them. As of 2026.11.",
    );
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain(
      `<link rel="canonical" href="https://allthings.dev${nowLabPath}"/>`,
    );
  });

  test("is listed in the lab, and nowhere on the site", () => {
    expect(labRootPage(page)).toContain(`<a href="${nowLabPath}">`);
    expect(sitemapXml([], page.origin)).not.toContain("/lab");
  });
});
