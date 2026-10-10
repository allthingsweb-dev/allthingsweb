import { describe, expect, test } from "bun:test";
import { sections } from "../src/pages/document.tsx";
import type { LabPage } from "../src/pages/lab/lab.tsx";
import { labRootPage, labs } from "../src/pages/lab/labs.tsx";
import { labPath, labRoot } from "../src/pages/lab/paths.ts";
import { labIndexPage } from "../src/pages/lab/variants.tsx";
import { sitemapXml } from "../src/seo/sitemap.ts";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/**
 * The lab's root, /lab (src/pages/lab/labs.tsx): every exploration with
 * its line, the first one the home lab. Public, unlinked from the site and
 * kept out of search, as every lab page is.
 */

const page: LabPage = {
  origin: "https://allthings.dev",
  theme: undefined,
  portraits: new Map(),
  images: "variants",
};

describe("/lab", () => {
  test("lists every exploration with its line, the home lab first", () => {
    const html = labRootPage(page);
    expect(labs[0]?.path).toBe(labPath);
    for (const lab of labs) {
      expect(html).toContain(`<a href="${lab.path}">`);
      expect(html).toContain(`<span>${lab.name}</span>`);
      expect(html).toContain(lab.line);
    }
  });

  test("names each exploration once, at a path under /lab", () => {
    const names = labs.map((lab) => lab.name);
    expect(new Set(names).size).toBe(names.length);
    for (const lab of labs) expect(lab.path).toStartWith(`${labRoot}/`);
  });

  test("is valid HTML, with one h1, kept out of search at its own address", async () => {
    const html = labRootPage(page);
    expect(await htmlProblems(html)).toEqual([]);
    expect(headingLevels(html)).toEqual([1]);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain(
      '<link rel="canonical" href="https://allthings.dev/lab"/>',
    );
    expect(html).toContain("<title>allthings/lab</title>");
  });

  test("is in neither the header nor the sitemap, and the home lab leads back to it", () => {
    expect(sections.map((section) => section.path)).not.toContain(labRoot);
    expect(sitemapXml([], page.origin)).not.toContain("/lab");
    const home = labIndexPage(page);
    expect(home).toContain(`<a href="${labRoot}">the lab</a> · home`);
    expect(home).toContain("<title>allthings/lab/home</title>");
  });
});
