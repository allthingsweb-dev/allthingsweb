import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isShortSlug, reservedSlugs } from "allthings-core/src/short-slugs.ts";
import { retiredPaths } from "../src/pages/routes.ts";
import { sitePages } from "../src/seo/sitemap.ts";
import { legacyUrls } from "./support/legacy-urls.ts";

/**
 * No evening's short link may be a path the site answers itself: core's
 * reservedSlugs (src/short-slugs.ts) holds every first segment of the
 * Worker's routes, its public files and the current site's URLs that could
 * be a link.
 */

const source = new URL("../src/", import.meta.url).pathname;
const publicFiles = new URL("../dist/public/", import.meta.url).pathname;

/** Every file under `directory`. */
async function filesIn(directory: string): Promise<Array<string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? filesIn(join(directory, entry.name))
        : Promise.resolve([join(directory, entry.name)]),
    ),
  );
  return nested.flat();
}

/** The paths the Worker's routes are declared at, as written. */
async function routePaths(): Promise<Array<string>> {
  const route =
    /(?:HttpRouter\.add\(\s*"[A-Z*]+",\s*|\bpage\(\s*|dataPage\(\s*)["`](\/[^"`]*)["`]/g;
  const paths: Array<string> = [];
  for (const file of await filesIn(source)) {
    if (!/\.tsx?$/.test(file)) continue;
    for (const [, path] of (await Bun.file(file).text()).matchAll(route)) {
      if (path !== undefined) paths.push(path);
    }
  }
  return paths;
}

/** A path's first segment. */
const firstSegment = (path: string): string =>
  path.replace(/^\/+/, "").split(/[/?#]/)[0] ?? "";

describe("short links", () => {
  test("are never a path the site answers itself", async () => {
    const paths = [
      ...(await routePaths()),
      ...sitePages,
      ...retiredPaths,
      // An evening's own URLs are evenings, not pages.
      ...legacyUrls
        .filter((entry) => !entry.pattern.includes("[slug]"))
        .map((entry) => entry.example),
      ...(await readdir(publicFiles)).map((name) => `/${name}`),
    ];
    const segments = new Set(paths.map(firstSegment).filter(isShortSlug));
    expect(segments.size).toBeGreaterThan(10);
    const unreserved = [...segments].filter(
      (segment) => !reservedSlugs.has(segment),
    );
    // Long slugs, which start with a date, are evenings, not pages.
    expect(unreserved.filter((segment) => !/^\d{4}-/.test(segment))).toEqual(
      [],
    );
  });
});
