import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl, PrivateCacheControl } from "../src/cache.ts";
import { eventDatabase, slugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * The Worker's page store in workerd, whose KV the local runtime provides:
 * a Worker with `PAGES` serves a page it has built from KV, by mode, without
 * reaching its database at all. Each Worker has a namespace of its own, so
 * they share nothing. They read their databases at DATABASE_URL, not
 * through Hyperdrive, so pages of a version are kept as soon as it is read.
 */

const origin = "https://allthings.dev";
const database = await serve(await eventDatabase(new Date()));
const lonely = await serve(await eventDatabase(new Date()));
/** Stops the orphan's database, once: mid-test, or at the end if it never ran. */
const stopLonely = (() => {
  let stopping: Promise<void> | undefined;
  return () => (stopping ??= lonely.stop());
})();

const refreshToken = crypto.randomUUID();

const Stack = testStack("allthings-web-page-store-test", {
  Cached: {
    ORIGIN: origin,
    DATABASE_URL: database.url,
    PAGES: true,
    SITE_REFRESH_TOKEN: refreshToken,
  },
  // Its database goes away mid-test, after its pages are warm.
  Orphaned: {
    ORIGIN: origin,
    DATABASE_URL: lonely.url,
    PAGES: true,
  },
  Uncached: { ORIGIN: origin, DATABASE_URL: database.url },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(
    Effect.ensuring(
      Effect.promise(() => Promise.all([database.stop(), stopLonely()])),
    ),
  ),
);

type Worker = "Cached" | "Orphaned" | "Uncached";

const it = (
  name: string,
  run: (urls: Record<Worker, string>) => Promise<void>,
) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => {
        const url = (worker: Worker) => {
          const value = outputs[worker];
          if (
            typeof value !== "string" ||
            !value.startsWith("http://localhost")
          ) {
            throw new Error(
              `${worker} is not running locally: ${String(value)}`,
            );
          }
          return value;
        };
        return run({
          Cached: url("Cached"),
          Orphaned: url("Orphaned"),
          Uncached: url("Uncached"),
        });
      }),
    ),
  );

const get = async (url: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${url}${path}`, init);
  return { response, html: await response.text() };
};

/** How the store served a response, from its Server-Timing. */
const state = (response: Response) =>
  /store;desc="([a-z]+)"/.exec(
    response.headers.get("server-timing") ?? "",
  )?.[1];

/**
 * `path` until the store answers it: a Worker's first request reads the
 * data's version after its response, and a page is kept after the
 * response that built it, so the very next request may still miss.
 */
async function warm(url: string, path: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { response, html } = await get(url, path, init);
    if (state(response) === "hit") return { response, html };
    await Bun.sleep(25);
  }
  throw new Error(`${path} never came from the store`);
}

const pages = [
  "/",
  "/events",
  "/people",
  "/about",
  "/brand",
  `/${slugs.upcoming}`,
  `/${slugs.past}`,
];

/** Until `url`'s Worker knows the data's version, it keeps nothing. */
async function primed(url: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { response } = await get(url, "/robots.txt?primed");
    if (state(response) !== "bypass") return;
    await Bun.sleep(25);
  }
  throw new Error(`${url} never read the data's version`);
}

describe("the page store", () => {
  for (const path of pages) {
    it(`builds ${path} once, then serves it from the store, the same page`, async ({
      Cached,
    }) => {
      await primed(Cached);
      const first = await get(Cached, path);
      expect(first.response.status).toBe(200);
      expect(state(first.response)).toBe("miss");
      const warmCopy = await warm(Cached, path);
      expect(warmCopy.html).toBe(first.html);
      expect(warmCopy.response.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(warmCopy.response.headers.get("vary")).toBe(
        "accept-encoding, cookie",
      );
    });
  }

  it("reports how long the database took on a miss, and nothing of it on a hit", async ({
    Cached,
  }) => {
    await primed(Cached);
    const miss = await get(Cached, "/events?timing");
    expect(miss.response.headers.get("server-timing")).toMatch(
      /^store;desc="miss";dur=\d+\.\d, db;dur=\d+\.\d$/,
    );
    const hit = await warm(Cached, "/events?timing");
    expect(hit.response.headers.get("server-timing")).toMatch(
      /^store;desc="hit";dur=\d+\.\d$/,
    );
  });

  it("keeps each mode apart, and a fixed mode private to its visitor", async ({
    Cached,
  }) => {
    const system = await warm(Cached, "/about");
    const night = await get(Cached, "/about", {
      headers: { cookie: "theme=dark" },
    });
    expect(night.html).toStartWith(
      '<!doctype html><html lang="en" data-theme="dark">',
    );
    const nightAgain = await warm(Cached, "/about", {
      headers: { cookie: "theme=dark" },
    });
    expect(nightAgain.html).toBe(night.html);
    expect(nightAgain.response.headers.get("cache-control")).toBe(
      PrivateCacheControl.publicData,
    );
    const paper = await warm(Cached, "/about", {
      headers: { cookie: "theme=light" },
    });
    expect(paper.html).toStartWith(
      '<!doctype html><html lang="en" data-theme="light">',
    );
    const systemAgain = await warm(Cached, "/about");
    expect(systemAgain.html).toBe(system.html);
    expect(systemAgain.response.headers.get("cache-control")).toBe(
      CacheControl.publicData,
    );
  });

  it("keeps an event page in the system's mode, and a visitor's mode apart from it", async ({
    Cached,
  }) => {
    const path = `/${slugs.bare}`;
    const own = await warm(Cached, path);
    expect(own.html).toStartWith('<!doctype html><html lang="en"><head>');
    const night = await warm(Cached, path, {
      headers: { cookie: "theme=dark" },
    });
    expect(night.html).toStartWith(
      '<!doctype html><html lang="en" data-theme="dark">',
    );
  });

  it("never keeps the mode switch's redirect", async ({ Cached }) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`${Cached}/about?theme=dark`, {
        redirect: "manual",
      });
      expect(response.status).toBe(303);
      expect(response.headers.get("set-cookie")).toStartWith("theme=dark;");
      expect(state(response)).not.toBe("hit");
      await response.arrayBuffer();
    }
  });

  it("keeps not found, as not found", async ({ Cached }) => {
    const { response } = await warm(Cached, "/no-such-evening");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(CacheControl.notFound);
  });

  it("serves warm pages without its database, and keeps no failure", async ({
    Orphaned,
  }) => {
    for (const path of pages) await warm(Orphaned, path);
    await stopLonely();
    for (const path of pages) {
      const { response } = await get(Orphaned, path);
      expect(response.status).toBe(200);
      expect(state(response)).toBe("hit");
    }
    // A page no one has asked for yet can't be built, and isn't kept.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response } = await get(Orphaned, "/events?cold");
      expect(response.status).toBe(503);
      expect(state(response)).toBe("miss");
    }
  });

  it("reads the data's version at once when a writer says it changed, with the token", async ({
    Cached,
    Uncached,
  }) => {
    await primed(Cached);
    const refresh = (url: string, authorization?: string) =>
      fetch(`${url}/_site/refresh`, {
        method: "POST",
        headers: authorization === undefined ? {} : { authorization },
      });
    const told = await refresh(Cached, `Bearer ${refreshToken}`);
    expect(told.status).toBe(200);
    expect(await told.json()).toMatchObject({
      version: expect.stringMatching(/^[0-9a-f]{32}$/),
      next: null,
    });
    const refused = await refresh(Cached, "Bearer not-the-token");
    expect(refused.status).toBe(401);
    await refused.arrayBuffer();
    // A Worker with no token has no such path.
    const none = await refresh(Uncached, `Bearer ${refreshToken}`);
    expect(none.status).toBe(404);
    await none.arrayBuffer();
  });

  it("prewarms every page the sitemap lists when a writer asks, with the token", async ({
    Cached,
  }) => {
    await primed(Cached);
    const warmed = await fetch(`${Cached}/_site/prewarm`, {
      method: "POST",
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    expect(warmed.status).toBe(200);
    const report = (await warmed.json()) as {
      paths: number;
      kept: number;
      built: number;
      failed: Array<string>;
    };
    expect(report.paths).toBeGreaterThan(5);
    expect(report.failed).toEqual([]);
    expect(report.kept + report.built).toBeGreaterThan(5);
    // A page it built is kept: the next visitor gets it from the store.
    const { response } = await get(Cached, "/events");
    expect(state(response)).toBe("hit");
  });

  it("is off without PAGES", async ({ Uncached }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response } = await get(Uncached, "/");
      expect(response.headers.get("server-timing")).toMatch(/^db;dur=/);
    }
  });
});
