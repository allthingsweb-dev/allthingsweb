import { describe, expect, test } from "bun:test";
import type { SitePointer } from "../src/page-store.ts";
import { longestWait, prewarm, sitemapPaths } from "../src/prewarm.ts";

/**
 * Prewarming the page store, as a function of a fake site behind it: what
 * it asks for, how it counts, and when it waits for a new version.
 */

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://allthings.dev/</loc></url>
  <url><loc>https://allthings.dev/events</loc></url>
  <url><loc> https://allthings.dev/people/ada-lovelace </loc></url>
  <url><loc>https://allthings.dev/events?a=1&amp;b=2</loc></url>
  <url><loc>https://allthings.dev/events</loc></url>
</urlset>`;

/** A site that answers the sitemap and every page as `served` says, keeping what it was asked. */
function fakeSite(served: (path: string) => string, status = 200) {
  const asked: Array<string> = [];
  const kept: Array<string> = [];
  const serve = async (
    request: Request,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) => {
    const { pathname, search } = new URL(request.url);
    const path = `${pathname}${search}`;
    asked.push(path);
    const how = served(path);
    // "miss" is built and written; "unwritten" is built, its write failed;
    // "unkeepable" is built and never kept.
    if (how === "miss" || how === "unwritten") {
      context.waitUntil(
        (async () => {
          await Bun.sleep(1);
          if (how === "miss") kept.push(path);
          return { kept: how === "miss" };
        })(),
      );
    }
    return new Response(path === "/sitemap.xml" ? sitemap : "<p>page</p>", {
      status: path === "/sitemap.xml" ? 200 : status,
      headers: {
        "server-timing": `store;desc="${how === "hit" ? "hit" : "miss"}";dur=1.0`,
      },
    });
  };
  return { serve, asked, kept };
}

const options = (
  site: ReturnType<typeof fakeSite>,
  pointer?: SitePointer,
  at = 1_000_000,
) => {
  const slept: Array<number> = [];
  return {
    slept,
    run: () =>
      prewarm({
        serve: site.serve,
        pointer: async () => pointer,
        now: () => at,
        sleep: async (ms) => {
          slept.push(ms);
        },
      }),
  };
};

describe("sitemapPaths", () => {
  test("is each <loc>'s path and query, once, on any host", () => {
    expect(sitemapPaths(sitemap)).toEqual([
      "/",
      "/events",
      "/people/ada-lovelace",
      "/events?a=1&b=2",
    ]);
  });
});

describe("prewarm", () => {
  test("asks for every page the sitemap lists, counts how each was served, and waits for each to be kept", async () => {
    const site = fakeSite((path) =>
      path === "/sitemap.xml" || path === "/events" ? "hit" : "miss",
    );
    const { run, slept } = options(site);
    expect(await run()).toEqual({
      paths: 5,
      kept: 2,
      built: 3,
      passed: 0,
      failed: [],
      sitemapRead: true,
      waitedMs: 0,
    });
    expect(site.asked[0]).toBe("/sitemap.xml");
    expect(site.asked.toSorted()).toEqual(
      [
        "/sitemap.xml",
        "/",
        "/events",
        "/people/ada-lovelace",
        "/events?a=1&b=2",
      ].toSorted(),
    );
    // Every page built was kept before it answered.
    expect(site.kept.toSorted()).toEqual(
      ["/", "/people/ada-lovelace", "/events?a=1&b=2"].toSorted(),
    );
    expect(slept).toEqual([]);
  });

  test("counts a page whose write failed as failed, and one never kept as passed", async () => {
    const site = fakeSite((path) =>
      path === "/sitemap.xml"
        ? "hit"
        : path === "/events"
          ? "unwritten"
          : path === "/"
            ? "unkeepable"
            : "miss",
    );
    const report = await options(site).run();
    expect(report).toMatchObject({
      kept: 1,
      built: 2,
      passed: 1,
      failed: ["/events"],
    });
  });

  test("tells a sitemap that was read but not written from one that wasn't read", async () => {
    const site = fakeSite((path) =>
      path === "/sitemap.xml" ? "unwritten" : "hit",
    );
    const report = await options(site).run();
    expect(report.failed).toEqual(["/sitemap.xml"]);
    expect(report.sitemapRead).toBe(true);
    expect(report.kept).toBe(4);
  });

  test("names the pages that failed", async () => {
    const site = fakeSite(() => "miss", 503);
    const report = await options(site).run();
    expect(report.failed.toSorted()).toEqual(
      ["/", "/events", "/people/ada-lovelace", "/events?a=1&b=2"].toSorted(),
    );
  });

  test("counts a sitemap or page whose body breaks as failed, once, and never throws", async () => {
    const broken = () =>
      new ReadableStream({
        start(controller) {
          controller.error(new Error("the body broke"));
        },
      });
    const report = await prewarm({
      serve: async () =>
        new Response(broken(), {
          headers: { "server-timing": 'store;desc="miss";dur=1.0' },
        }),
      pointer: async () => undefined,
      now: () => 0,
      sleep: async () => undefined,
    });
    expect(report.failed).toEqual(["/sitemap.xml"]);
    expect(report.sitemapRead).toBe(false);
    expect(report.paths).toBe(1);
  });

  test("waits for a new version to be in use first, but never past the longest wait", async () => {
    const v = { version: "v1", boundaries: [] };
    const soon = options(
      fakeSite(() => "hit"),
      {
        checkedAt: 0,
        current: v,
        next: { version: "v2", boundaries: [], from: 1_000_000 + 75_000 },
      },
    );
    expect((await soon.run()).waitedMs).toBe(75_000);
    expect(soon.slept).toEqual([75_000]);
    const far = options(
      fakeSite(() => "hit"),
      {
        checkedAt: 0,
        current: v,
        next: {
          version: "v2",
          boundaries: [],
          from: 1_000_000 + longestWait + 1,
        },
      },
    );
    expect((await far.run()).waitedMs).toBe(0);
    const settled = options(
      fakeSite(() => "hit"),
      {
        checkedAt: 0,
        current: v,
        next: { version: "v2", boundaries: [], from: 1 },
      },
    );
    expect(settled.slept).toEqual([]);
    expect((await settled.run()).waitedMs).toBe(0);
  });
});
