import { eventPathOf } from "allthings-core/src/mappers.ts";
import { describe, expect, test } from "bun:test";
import {
  cutoverRedirect,
  lookupTimeout,
  mediaOrigin as appMediaOrigin,
  newOrigin,
  shortLinkPath,
} from "../../app/src/lib/cutover/redirect.ts";
import { mediaOrigin } from "../src/links.ts";
import { longSlugs, slugs } from "./support/event-catalog.ts";
import { legacyUrls } from "./support/legacy-urls.ts";

/**
 * The cutover's redirect on the current site (app/src/lib/cutover), held to
 * the legacy-URL manifest: every URL the current site answers goes to
 * allthings.dev in one hop, to where the Worker would finally serve it.
 */

/** The catalog's long slugs and the short links they have (support/event-catalog.ts). */
const shortLinks = new Map<string, string>(
  (Object.keys(longSlugs) as Array<keyof typeof longSlugs>).flatMap((key) =>
    longSlugs[key] === slugs[key] ? [] : [[longSlugs[key], slugs[key]]],
  ),
);
const shortLink = async (slug: string) => shortLinks.get(slug) ?? null;

const redirectOf = (example: string, method = "GET") => {
  const url = new URL(example, "https://allthingsweb.dev");
  return cutoverRedirect(
    { method, pathname: url.pathname, search: url.search },
    shortLink,
  );
};

/**
 * Where the manifest says an example ends up: where the Worker sends it for
 * good (a 301 or 308), absolute; else, as the Worker answers it there, at
 * the same path and query. A 307 is the Worker's to make, each time.
 */
const finalTarget = (entry: (typeof legacyUrls)[number]): string => {
  const { worker } = entry;
  if (worker.status === 301 || worker.status === 308) {
    return worker.location.startsWith("/")
      ? `${newOrigin}${worker.location}`
      : worker.location;
  }
  return `${newOrigin}${entry.example}`;
};

describe("the cutover's redirect", () => {
  for (const entry of legacyUrls) {
    test(`sends ${entry.pattern} to where the Worker serves it, in one hop`, async () => {
      expect(await redirectOf(entry.example)).toEqual({
        status: 301,
        location: finalTarget(entry),
      });
    });
  }

  test("the manifest's long slugs and redirects resolve as the catalog has them", async () => {
    expect(await redirectOf(`/${longSlugs.past}`)).toEqual({
      status: 301,
      location: "https://allthings.dev/web-2025-01",
    });
    // Someone else's evening's short link is two segments.
    expect(await redirectOf(`/${longSlugs.shared}`)).toEqual({
      status: 301,
      location: "https://allthings.dev/shared/demo-day",
    });
    // An evening without a short link yet, and a draft: the same path.
    for (const slug of [longSlugs.live, longSlugs.draft]) {
      expect((await redirectOf(`/${slug}`)).location).toBe(
        `https://allthings.dev/${slug}`,
      );
    }
    expect(await redirectOf(`/${longSlugs.past}/?utm_source=qr`)).toEqual({
      status: 301,
      location: "https://allthings.dev/web-2025-01?utm_source=qr",
    });
  });

  test("keeps the method and body of anything but GET and HEAD, with a 308", async () => {
    for (const [path, method] of [
      ["/mcp", "POST"],
      ["/api/v1/events?limit=3", "POST"],
      ["/api/v1/admin/raw/talks", "DELETE"],
      [`/${longSlugs.past}`, "POST"],
      ["/speakers", "OPTIONS"],
    ] as const) {
      expect(await redirectOf(path, method)).toEqual({
        status: 308,
        location: `https://allthings.dev${path}`,
      });
    }
    expect(await redirectOf(`/${longSlugs.past}`, "HEAD")).toEqual({
      status: 301,
      location: "https://allthings.dev/web-2025-01",
    });
  });

  test("sends the API, MCP and anything unknown to the same path, query kept", async () => {
    for (const path of [
      "/api/v1/events?limit=2&when=past",
      "/api/v1/events/e0000000-0000-4000-8000-000000000503",
      "/api/v1/speakers",
      "/mcp",
      "/people",
      "/people/ada-lovelace",
      "/no/such/page?x=1",
      "/",
    ]) {
      expect(await redirectOf(path)).toEqual({
        status: 301,
        location: `https://allthings.dev${path}`,
      });
    }
  });

  test("never lets a failed lookup or a malformed path stop the redirect", async () => {
    expect(
      await cutoverRedirect(
        { method: "GET", pathname: `/${longSlugs.past}`, search: "" },
        () => Promise.reject(new Error("the database is down")),
      ),
    ).toEqual({
      status: 301,
      location: `https://allthings.dev/${longSlugs.past}`,
    });
    expect((await redirectOf("/%E0%A4%A")).location).toBe(
      "https://allthings.dev/%E0%A4%A",
    );
    // One that throws before it returns, as a bad connection string would.
    expect(
      await cutoverRedirect(
        { method: "GET", pathname: `/${longSlugs.past}`, search: "" },
        () => {
          throw new Error("no database");
        },
      ),
    ).toEqual({
      status: 301,
      location: `https://allthings.dev/${longSlugs.past}`,
    });
  });

  test(`goes on without a lookup that takes longer than ${lookupTimeout} ms`, async () => {
    const started = Date.now();
    expect(
      await cutoverRedirect(
        { method: "GET", pathname: `/${longSlugs.past}`, search: "" },
        () => new Promise(() => undefined),
      ),
    ).toEqual({
      status: 301,
      location: `https://allthings.dev/${longSlugs.past}`,
    });
    expect(Date.now() - started).toBeLessThan(lookupTimeout + 1000);
  });

  test("never looks up the site's own pages or files", async () => {
    const asked: Array<string> = [];
    for (const path of [
      "/about",
      "/mcp",
      "/rss",
      "/people",
      "/robots.txt",
      "/favicon.ico",
      "/manifest.webmanifest",
    ]) {
      await cutoverRedirect(
        { method: "GET", pathname: path, search: "" },
        async (slug) => {
          asked.push(slug);
          return null;
        },
      );
    }
    expect(asked).toEqual([]);
  });

  test("writes short links as core does, and knows the same media origin", () => {
    for (const link of [
      "effect",
      "shared/demo-day",
      "café",
      "a b",
      "shared/",
    ]) {
      expect(shortLinkPath(link)).toBe(eventPathOf(link));
    }
    expect(appMediaOrigin).toBe(mediaOrigin);
  });
});
