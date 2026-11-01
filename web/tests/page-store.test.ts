import { describe, expect, test } from "bun:test";
import {
  CacheControl,
  edgeCacheControlHeader,
  PrivateCacheControl,
} from "../src/cache.ts";
import {
  checkEvery,
  effectiveState,
  keepable,
  nextPointer,
  type PageNamespace,
  pageKey,
  pageStored,
  parsePointer,
  type SitePointer,
  type SiteState,
  siteKey,
  windowAt,
} from "../src/page-store.ts";

/**
 * The page store as a pure function of a fake KV namespace, a fake clock and
 * a fake database: what it keeps, under which key, when it asks the
 * database, and what each visitor gets back.
 */

/** A namespace that keeps values in memory, as KV does, counting reads and writes. */
function memoryNamespace() {
  const entries = new Map<string, ArrayBuffer>();
  const puts: Array<{ key: string; expirationTtl: number | undefined }> = [];
  let unreachable = false;
  const pages: PageNamespace = {
    get: async (key) => {
      if (unreachable) throw new Error("KV is unreachable");
      const value = entries.get(key);
      return value === undefined ? null : value.slice(0);
    },
    put: async (key, value, options) => {
      if (unreachable) throw new Error("KV is unreachable");
      entries.set(
        key,
        typeof value === "string"
          ? new TextEncoder().encode(value).buffer
          : value.slice(0),
      );
      puts.push({ key, expirationTtl: options?.expirationTtl });
    },
  };
  const pointer = (): SitePointer | undefined => {
    const bytes = entries.get(siteKey);
    return bytes === undefined
      ? undefined
      : parsePointer(new TextDecoder().decode(bytes));
  };
  const pageKeys = () => [...entries.keys()].filter((key) => key !== siteKey);
  return {
    pages,
    entries,
    puts,
    pointer,
    pageKeys,
    breaks: () => {
      unreachable = true;
    },
  };
}

/** A clock that moves only when told, in seconds. */
function clock(start = Date.UTC(2026, 10, 1, 20, 0, 0)) {
  let now = start;
  return {
    now: () => now,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

/** A database whose data is `state`, counting how often it is asked. */
function database(initial: SiteState) {
  let state = initial;
  let asked = 0;
  return {
    siteState: async () => {
      asked += 1;
      return state;
    },
    change: (next: SiteState) => {
      state = next;
    },
    asked: () => asked,
  };
}

/** What waitUntil was handed, so a test can wait for it. */
function context() {
  const pending: Array<Promise<unknown>> = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    settle: async () => {
      while (pending.length > 0) await Promise.all(pending.splice(0));
    },
  };
}

interface Page {
  readonly status?: number;
  readonly cacheControl?: string;
  readonly headers?: Record<string, string>;
}

/** A handler that counts its calls and answers with `page` and the call's number. */
function handler(page: (request: Request) => Page) {
  let calls = 0;
  const handle = async (request: Request) => {
    calls += 1;
    const {
      status = 200,
      cacheControl = CacheControl.publicData,
      headers = {},
    } = page(request);
    return new Response(
      `<p>build ${calls} for ${request.headers.get("cookie") ?? "no cookie"}</p>`,
      {
        status,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": cacheControl,
          "content-encoding": "br",
          "server-timing": "db;dur=40.0",
          ...headers,
        },
      },
    );
  };
  return { handle, calls: () => calls };
}

const site = "https://allthings.dev";
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${site}${path}`, {
    headers: { "accept-encoding": "br, gzip", ...headers },
  });

/** How the store served a response, from its Server-Timing. */
const served = (response: Response) =>
  /store;desc="([a-z]+)"/.exec(
    response.headers.get("server-timing") ?? "",
  )?.[1];

const v1: SiteState = { version: "v1", boundaries: [] };
const v2: SiteState = { version: "v2", boundaries: [] };
const turnover = 75_000;

const setup = (
  options: {
    readonly page?: (request: Request) => Page;
    readonly state?: SiteState;
    readonly turnover?: number;
  } = {},
) => {
  const kv = memoryNamespace();
  const time = clock();
  const data = database(options.state ?? v1);
  const app = handler(options.page ?? (() => ({})));
  const ctx = context();
  const serve = pageStored(app.handle, {
    pages: kv.pages,
    build: "0123456789abcdef",
    now: time.now,
    siteState: data.siteState,
    turnover: options.turnover ?? 0,
  });
  const fetch = async (request: Request) => {
    const response = await serve(request, ctx);
    const body = await response.text();
    await ctx.settle();
    return { response, body };
  };
  return { fetch, kv, time, data, app };
};

describe("the page store", () => {
  test("asks the database for the version first, then builds each page once and serves it from KV", async () => {
    const { fetch, kv, app, data } = setup();
    // No version yet: the page is built and not kept, and the database asked.
    expect(served((await fetch(get("/"))).response)).toBe("bypass");
    expect(data.asked()).toBe(1);
    expect(kv.pointer()?.next?.version).toBe("v1");
    const miss = await fetch(get("/"));
    expect(served(miss.response)).toBe("miss");
    expect(miss.response.headers.get("server-timing")).toContain("db;dur=40.0");
    const hit = await fetch(get("/"));
    expect(served(hit.response)).toBe("hit");
    expect(hit.body).toBe(miss.body);
    expect(hit.response.headers.get("server-timing")).not.toContain("db;");
    expect(app.calls()).toBe(2);
    expect(kv.pageKeys()).toHaveLength(1);
    expect(kv.puts.find(({ key }) => key !== siteKey)?.expirationTtl).toBe(
      30 * 24 * 60 * 60,
    );
  });

  test("keeps a page for as long as the data doesn't change, however long that is", async () => {
    const { fetch, time, app } = setup();
    await fetch(get("/"));
    await fetch(get("/"));
    for (let day = 0; day < 10; day++) {
      time.advance(24 * 60 * 60);
      expect(served((await fetch(get("/"))).response)).toBe("hit");
    }
    expect(app.calls()).toBe(2);
  });

  test("asks the database at most every five minutes, and builds a new version's pages only after the turnover", async () => {
    const { fetch, time, data, kv } = setup({ turnover });
    await fetch(get("/"));
    time.advance(turnover / 1000);
    await fetch(get("/"));
    expect(served((await fetch(get("/"))).response)).toBe("hit");
    const asked = data.asked();
    time.advance(60);
    await fetch(get("/"));
    expect(data.asked()).toBe(asked);

    data.change(v2);
    time.advance(checkEvery / 1000);
    // The request that finds the version old is served the old page, and
    // the database is asked after it.
    expect(served((await fetch(get("/"))).response)).toBe("hit");
    expect(data.asked()).toBe(asked + 1);
    expect(kv.pointer()?.current?.version).toBe("v1");
    expect(kv.pointer()?.next?.version).toBe("v2");
    // Until Hyperdrive can no longer answer from before the change, the
    // old version's pages are served.
    time.advance(turnover / 1000 - 1);
    expect(served((await fetch(get("/"))).response)).toBe("hit");
    time.advance(1);
    const fresh = await fetch(get("/"));
    expect(served(fresh.response)).toBe("miss");
    expect(served((await fetch(get("/"))).response)).toBe("hit");
  });

  test("builds a page again in each time window the data names", async () => {
    const start = Date.UTC(2026, 10, 1, 20, 0, 0);
    const { fetch, time, app } = setup({
      state: { version: "v1", boundaries: [start + 10 * 60_000] },
    });
    await fetch(get("/"));
    await fetch(get("/"));
    time.advance(9 * 60);
    expect(served((await fetch(get("/"))).response)).toBe("hit");
    time.advance(60);
    expect(served((await fetch(get("/"))).response)).toBe("miss");
    expect(served((await fetch(get("/"))).response)).toBe("hit");
    expect(app.calls()).toBe(3);
  });

  test("keeps each mode apart, and a fixed mode by the lifetimes its page names", async () => {
    const { fetch } = setup({
      page: (request) =>
        request.headers.get("cookie") === "theme=dark"
          ? {
              cacheControl: PrivateCacheControl.publicData,
              headers: { [edgeCacheControlHeader]: CacheControl.publicData },
            }
          : {},
    });
    await fetch(get("/"));
    const system = await fetch(get("/"));
    const night = await fetch(get("/", { cookie: "theme=dark" }));
    expect(served(night.response)).toBe("miss");
    expect(night.body).not.toBe(system.body);
    const again = await fetch(get("/", { cookie: "theme=dark" }));
    expect(served(again.response)).toBe("hit");
    expect(again.body).toBe(night.body);
    // Its visitor is told what the page said; the store's note stays home.
    expect(again.response.headers.get("cache-control")).toBe(
      PrivateCacheControl.publicData,
    );
    expect(again.response.headers.has(edgeCacheControlHeader)).toBe(false);
    expect(night.response.headers.has(edgeCacheControlHeader)).toBe(false);
    expect((await fetch(get("/"))).body).toBe(system.body);
  });

  test("compresses each kept page for the visitor it is served to", async () => {
    const { fetch } = setup();
    await fetch(get("/"));
    await fetch(get("/"));
    const br = await fetch(get("/"));
    expect(br.response.headers.get("content-encoding")).toBe("br");
    const gzip = await fetch(get("/", { "accept-encoding": "gzip" }));
    expect(gzip.response.headers.get("content-encoding")).toBe("gzip");
    const plain = await fetch(get("/", { "accept-encoding": "identity" }));
    expect(plain.response.headers.has("content-encoding")).toBe(false);
    expect(plain.body).toBe(br.body);
  });

  test.each([
    ["private", { cacheControl: "private, max-age=60" }],
    ["no-store", { cacheControl: "no-store" }],
    ["without s-maxage", { cacheControl: "public, max-age=60" }],
    ["a failure", { status: 503 }],
    ["a redirect", { status: 301 }],
    ["a cookie set", { headers: { "set-cookie": "theme=dark" } }],
  ] as const)("never keeps %s", async (_, page) => {
    const { fetch, kv, app } = setup({ page: () => page });
    await fetch(get("/"));
    await fetch(get("/"));
    expect(served((await fetch(get("/"))).response)).toBe("miss");
    expect(kv.pageKeys()).toEqual([]);
    expect(app.calls()).toBe(3);
  });

  test("keeps not found, as not found", async () => {
    const { fetch } = setup({
      page: () => ({ status: 404, cacheControl: CacheControl.notFound }),
    });
    await fetch(get("/nowhere"));
    await fetch(get("/nowhere"));
    const hit = await fetch(get("/nowhere"));
    expect(served(hit.response)).toBe("hit");
    expect(hit.response.status).toBe(404);
  });

  test("keeps no page built past a boundary under the window before it", async () => {
    const start = Date.UTC(2026, 10, 1, 20, 0, 0);
    const kv = memoryNamespace();
    const time = clock(start + 50_000);
    const ctx = context();
    const serve = pageStored(
      async () => {
        // The build takes long enough to reach the next window.
        time.advance(6);
        return new Response("<p>live</p>", {
          headers: {
            "content-type": "text/html",
            "cache-control": CacheControl.publicData,
          },
        });
      },
      {
        pages: kv.pages,
        build: "b",
        now: time.now,
        siteState: async () => ({
          version: "v1",
          boundaries: [start + 60_000],
        }),
        turnover: 0,
      },
    );
    await serve(get("/"), ctx);
    await ctx.settle();
    await serve(get("/"), ctx);
    await ctx.settle();
    expect(kv.pageKeys()).toEqual([]);
  });

  test("passes anything but a GET straight through, and a client refusing every coding", async () => {
    const { fetch, kv, app } = setup();
    await fetch(get("/"));
    await fetch(new Request(`${site}/`, { method: "HEAD" }));
    await fetch(get("/", { "accept-encoding": "identity;q=0, *;q=0" }));
    expect(kv.pageKeys()).toEqual([]);
    expect(app.calls()).toBe(3);
  });

  test("answers from the app when KV can't be reached", async () => {
    const { fetch, kv } = setup();
    await fetch(get("/"));
    await fetch(get("/"));
    kv.breaks();
    const { response, body } = await fetch(get("/"));
    expect(response.status).toBe(200);
    expect(body).toContain("build");
  });

  test("leaves photo variants to their own cache", async () => {
    const { fetch, kv } = setup();
    await fetch(get("/"));
    const { response } = await fetch(get("/img/480/webp/1/people/ada.jpg"));
    expect(served(response)).toBeUndefined();
    expect(kv.pageKeys()).toEqual([]);
  });
});

describe("nextPointer", () => {
  test("starts with the version it reads, used after the turnover", () => {
    expect(nextPointer(undefined, v1, 1_000, turnover)).toEqual({
      checkedAt: 1_000,
      next: { ...v1, from: 1_000 + turnover },
    });
  });

  test("only notes the time when nothing changed, and settles a next one whose time has come", () => {
    const pointer: SitePointer = {
      checkedAt: 0,
      current: v1,
      next: { ...v2, from: 100 },
    };
    expect(nextPointer(pointer, v2, 200, turnover)).toEqual({
      checkedAt: 200,
      current: v2,
    });
    // Asked again before its time, a next one waits as it was.
    expect(nextPointer(pointer, v2, 50, turnover)).toEqual({
      ...pointer,
      checkedAt: 50,
    });
  });

  test("keeps serving what is in use while a newer one waits", () => {
    const pointer: SitePointer = { checkedAt: 0, current: v1 };
    const next = nextPointer(pointer, v2, 1_000, turnover);
    expect(effectiveState(next, 1_000)).toEqual(v1);
    expect(effectiveState(next, 1_000 + turnover)).toMatchObject(v2);
  });
});

describe("parsePointer", () => {
  test("reads what the store writes", () => {
    const pointer: SitePointer = {
      checkedAt: 1,
      current: v1,
      next: { ...v2, from: 2 },
    };
    expect(parsePointer(JSON.stringify(pointer))).toEqual(pointer);
  });

  test.each([
    "not json",
    "null",
    "{}",
    '{"checkedAt":"soon"}',
    '{"checkedAt":1,"current":{"version":1,"boundaries":[]}}',
    '{"checkedAt":1,"next":{"version":"v","boundaries":[]}}',
  ])("refuses %s", (text) => {
    expect(parsePointer(text)).toBeUndefined();
  });
});

describe("windowAt", () => {
  test("counts the boundaries passed by the minute pages read the data as of", () => {
    const boundary = Date.UTC(2026, 10, 1, 20, 0, 30);
    // 20:00:45 reads as of 20:00, before the boundary.
    expect(windowAt([boundary], Date.UTC(2026, 10, 1, 20, 0, 45))).toBe(
      windowAt([boundary], Date.UTC(2026, 10, 1, 19, 0)),
    );
    expect(windowAt([boundary], Date.UTC(2026, 10, 1, 20, 1))).not.toBe(
      windowAt([boundary], Date.UTC(2026, 10, 1, 20, 0, 45)),
    );
  });

  test("starts a new one at midnight on New Year's in San Francisco", () => {
    expect(windowAt([], Date.UTC(2027, 0, 1, 7, 59))).toBe("0.2026");
    expect(windowAt([], Date.UTC(2027, 0, 1, 8, 0))).toBe("0.2027");
  });
});

describe("pageKey", () => {
  test("is the build, the version, the window, the mode and the URL's digest", async () => {
    const key = await pageKey(get("/events?x=1"), "b", v1, 0);
    expect(key).toMatch(/^page\/b\/v1\/0\.1969\/system\/[0-9a-f]{64}$/);
    expect(await pageKey(get("/events?x=2"), "b", v1, 0)).not.toBe(key);
    expect(
      await pageKey(get("/events?x=1", { cookie: "theme=dark" }), "b", v1, 0),
    ).toContain("/dark/");
    // A mode it doesn't know is the system's, as pages read it.
    expect(
      await pageKey(get("/events?x=1", { cookie: "theme=sepia" }), "b", v1, 0),
    ).toBe(key);
  });
});

describe("keepable", () => {
  test("is a 200 or 404 a shared cache may keep, without a cookie set", () => {
    const response = (status: number, headers: Record<string, string>) =>
      new Response(null, { status, headers });
    expect(
      keepable(response(200, { "cache-control": CacheControl.publicData })),
    ).toBe(true);
    expect(
      keepable(response(404, { "cache-control": CacheControl.notFound })),
    ).toBe(true);
    expect(
      keepable(response(200, { "cache-control": CacheControl.page })),
    ).toBe(true);
    expect(
      keepable(response(200, { "cache-control": CacheControl.failure })),
    ).toBe(false);
  });
});
