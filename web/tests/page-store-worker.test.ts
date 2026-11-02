import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import {
  CacheControl,
  PrivateCacheControl,
  workersCacheHeader,
  workersCacheLifetime,
} from "../src/cache.ts";
import {
  canonicalInput,
  keptInputMax,
  toolLocation,
} from "../src/mcp/endpoint.ts";
import { portraitsPath } from "../src/pages/routes.ts";
import { eventDatabase, slugs } from "./support/event-catalog.ts";
import { mcpRequest, rpcMessage } from "./support/http.ts";
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

/** A page's footer, where the hosts' portraits are. */
const footerOf = (html: string) => /<footer[\s\S]*<\/footer>/.exec(html)?.[0];

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
      /^store;desc="miss";dur=\d+\.\d, pointer;desc="(memory|local|kv)";dur=\d+\.\d(, isolate;desc="new")?, db;dur=\d+\.\d$/,
    );
    const hit = await warm(Cached, "/events?timing");
    expect(hit.response.headers.get("server-timing")).toMatch(
      /^store;desc="hit";dur=\d+\.\d, pointer;desc="(memory|local|kv)";dur=\d+\.\d, copy;desc="(local|kv)";dur=\d+\.\d(, isolate;desc="new")?$/,
    );
  });

  it("answers a HEAD from the store as its GET, without a body or the database", async ({
    Cached,
  }) => {
    await primed(Cached);
    const kept = await warm(Cached, "/events?head");
    const head = await fetch(`${Cached}/events?head`, { method: "HEAD" });
    const timing = head.headers.get("server-timing") ?? "";
    expect(timing).toStartWith('store;desc="hit"');
    expect(timing).not.toContain("db;");
    expect(head.status).toBe(kept.response.status);
    for (const name of ["content-type", "cache-control", "vary"]) {
      expect([name, head.headers.get(name)]).toEqual([
        name,
        kept.response.headers.get(name),
      ]);
    }
    expect(await head.text()).toBe("");
    // workerd gives a HEAD that says `Content-Length: 0` a body, which a
    // GET can't have: it is answered all the same.
    const counted = await fetch(`${Cached}/events?head`, {
      method: "HEAD",
      headers: { "content-length": "0" },
    });
    expect(counted.status).toBe(kept.response.status);
    expect(counted.headers.get("server-timing") ?? "").toStartWith(
      'store;desc="hit"',
    );
    expect(await counted.text()).toBe("");
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
    // Workers Cache keeps no page in a mode a cookie fixed.
    expect(nightAgain.response.headers.get(workersCacheHeader)).toBe(
      "no-store",
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
    expect(systemAgain.response.headers.get(workersCacheHeader)).toBe(
      workersCacheLifetime,
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

  it("answers MCP tools through the store, so a call already answered reads no database", async ({
    Cached,
  }) => {
    await primed(Cached);
    const listEvents = async (id: number) => {
      const response = await fetch(
        mcpRequest(`${Cached}/mcp`, {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "list_events",
            arguments: { when: "past", limit: 3 },
          },
        }),
      );
      return rpcMessage(await response.text()) as {
        id: number;
        result: { isError?: boolean; structuredContent: { events: unknown[] } };
      };
    };
    const first = await listEvents(7);
    expect(first.id).toBe(7);
    expect(first.result.isError).toBeUndefined();
    expect(first.result.structuredContent.events.length).toBeGreaterThan(0);
    // The tool's answer is kept like a page, by its input.
    const path = `/_mcp/tools/list_events?input=${encodeURIComponent('{"limit":3,"when":"past"}')}`;
    const kept = await warm(Cached, path);
    expect(JSON.parse(kept.html)).toEqual(first.result);
    // The store keeps the tool's result, never the reply around it.
    const replay = await listEvents(8);
    expect(replay.id).toBe(8);
    expect(replay.result).toEqual(first.result);
  });

  it("keeps a call whose input the URL parser escapes, like an apostrophe", async ({
    Cached,
  }) => {
    const call = await fetch(
      mcpRequest(`${Cached}/mcp`, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_speakers", arguments: { query: "O'Brien" } },
      }),
    );
    const reply = rpcMessage(await call.text()) as {
      result: { isError?: boolean };
    };
    expect(reply.result.isError).toBeUndefined();
    const kept = await warm(
      Cached,
      toolLocation(
        "list_speakers",
        canonicalInput({ limit: 50, query: "O'Brien" }),
      ),
    );
    expect(JSON.parse(kept.html)).toEqual(reply.result);
  });

  it("refuses a tool it doesn't have, or input that isn't one call's canonical form, and keeps neither", async ({
    Cached,
  }) => {
    for (const path of [
      "/_mcp/tools/drop_tables",
      `/_mcp/tools/list_events?input=${encodeURIComponent('{"limit":-1}')}`,
      "/_mcp/tools/get_event?input=not-json",
      // The same call as the kept one above, spelled another way each time.
      `/_mcp/tools/list_events?input=${encodeURIComponent('{"when":"past","limit":3}')}`,
      `/_mcp/tools/list_events?input=${encodeURIComponent('{"limit": 3, "when": "past"}')}`,
      `/_mcp/tools/list_events?input=${encodeURIComponent('{"limit":3,"when":"past","extra":1}')}`,
      `/_mcp/tools/list_speakers?input=${encodeURIComponent('{"limit":50,"query":" ada "}')}`,
      `/_mcp/tools/get_event?input=${encodeURIComponent(JSON.stringify({ slug: "x".repeat(keptInputMax) }))}`,
      // The kept call's own input, under another address.
      `/_mcp/tools/list_events?input=${encodeURIComponent('{"limit":3,"when":"past"}')}&nonce=1`,
      `/_mcp/tools/list_events?nonce=1&input=${encodeURIComponent('{"limit":3,"when":"past"}')}`,
      `/_mcp/tools/list%5Fevents?input=${encodeURIComponent('{"limit":3,"when":"past"}')}`,
      '/_mcp/tools/list_events?input={"limit":3,"when":"past"}',
      "/_mcp/tools/get_community",
    ]) {
      const { response } = await get(Cached, path);
      expect(response.status).toBe(400);
      expect(state(response)).not.toBe("hit");
    }
    // A call too long to keep is still answered, from the database.
    const response = await fetch(
      mcpRequest(`${Cached}/mcp`, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_event",
          arguments: { slug: "x".repeat(keptInputMax) },
        },
      }),
    );
    const long = rpcMessage(await response.text()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    // The tool looked: no event has that slug.
    expect(long.result.isError).toBe(true);
    expect(long.result.content[0]?.text).not.toBe("Invalid input");
  });

  it("keeps the hosts' portraits at one address only", async ({ Cached }) => {
    const kept = await warm(Cached, portraitsPath);
    expect(kept.response.headers.get("content-type")).toStartWith(
      "application/json",
    );
    expect(kept.html).toContain("profiles/erik.jpg");
    const aliased = await get(Cached, `${portraitsPath}?nonce=1`);
    expect(aliased.response.status).toBe(400);
    expect(state(aliased.response)).not.toBe("hit");
  });

  it("serves warm pages without its database, and keeps no failure", async ({
    Orphaned,
  }) => {
    for (const path of pages) await warm(Orphaned, path);
    // An MCP call answered once is answered again with the database gone.
    const tool = () =>
      fetch(
        mcpRequest(`${Orphaned}/mcp`, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_speakers", arguments: {} },
        }),
      ).then(
        async (response) =>
          rpcMessage(await response.text()) as {
            result: { isError?: boolean };
          },
      );
    const before = await tool();
    // A path no one serves takes its footer from the store, which keeps it.
    const scanned = await get(Orphaned, "/.env");
    expect(scanned.response.status).toBe(404);
    expect(footerOf(scanned.html)).toContain("profiles/erik.jpg");
    await warm(Orphaned, portraitsPath);
    await stopLonely();
    // Found in the store with the database gone: the call above kept it.
    await warm(
      Orphaned,
      `/_mcp/tools/list_speakers?input=${encodeURIComponent('{"limit":50}')}`,
    );
    expect((await tool()).result).toEqual(before.result);
    expect(before.result.isError).toBeUndefined();
    for (const path of pages) {
      const { response } = await get(Orphaned, path);
      expect(response.status).toBe(200);
      expect(state(response)).toBe("hit");
    }
    // A path no evening, person or page could have is not found with the
    // database gone: it reads nothing, and its footer comes from the store.
    for (const path of [
      "/wp-login.php",
      "/.git/config",
      "/shared/.env",
      "/people/No.One",
    ]) {
      const { response, html } = await get(Orphaned, path);
      expect([path, response.status]).toEqual([path, 404]);
      expect(response.headers.get("cache-control")).toBe(CacheControl.notFound);
      expect(response.headers.get("server-timing")).not.toContain("db;");
      // The hosts' portraits as the database had them.
      expect(footerOf(html)).toBe(footerOf(scanned.html));
    }
    const calendar = await get(Orphaned, "/x.php/calendar.ics");
    expect([calendar.response.status, calendar.html]).toEqual([
      404,
      "Event not found",
    ]);
    // One that could be a new evening's is looked up, so it can't be now.
    expect((await get(Orphaned, "/no-such-evening")).response.status).toBe(503);
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
