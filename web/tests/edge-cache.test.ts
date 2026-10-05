import { describe, expect, test } from "bun:test";
import {
  CacheControl,
  edgeCacheControlHeader,
  PrivateCacheControl,
} from "../src/cache.ts";
import {
  edgeCached,
  edgeKey,
  edgePolicy,
  freshness,
  type ResponseCache,
} from "../src/edge-cache.ts";

/**
 * The Worker's own cache as a pure function of a fake data-center cache and
 * a fake clock: what it keeps, under which key, for how long, and what each
 * visitor gets back.
 */

/** A data center's cache that keeps responses in memory, as the Cache API does. */
function memoryCache() {
  const entries = new Map<string, Response>();
  const cache: ResponseCache = {
    match: async (key) => {
      const kept = entries.get(key.url);
      return kept === undefined
        ? undefined
        : new Response(await kept.clone().arrayBuffer(), kept);
    },
    put: async (key, response) => {
      entries.set(
        key.url,
        new Response(await response.arrayBuffer(), response),
      );
    },
  };
  return { cache, entries };
}

/** A clock that moves only when told, in seconds. */
function clock(start = 1_800_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

/** What waitUntil was handed, so a test can wait for it. */
function context() {
  const pending: Array<Promise<unknown>> = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    settle: () => Promise.all(pending.splice(0)),
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

/** The cache state a response's Server-Timing reports. */
const state = (response: Response) =>
  /cache;desc="([a-z]+)"/.exec(
    response.headers.get("server-timing") ?? "",
  )?.[1];

const setup = (page: (request: Request) => Page = () => ({})) => {
  const memory = memoryCache();
  const time = clock();
  const app = handler(page);
  const ctx = context();
  const serve = edgeCached(app.handle, {
    cache: memory.cache,
    build: "site/0123456789abcdef",
    now: time.now,
  });
  const fetch = async (request: Request) => {
    const response = await serve(request, ctx);
    const body = await response.text();
    await ctx.settle();
    return { response, body };
  };
  return { fetch, memory, time, app };
};

describe("edgePolicy", () => {
  test.each([
    [CacheControl.publicData, { fresh: 300, stale: 3600 }],
    [CacheControl.page, { fresh: 86400, stale: 0 }],
    [CacheControl.notFound, { fresh: 60, stale: 0 }],
    ["public, s-maxage=10, stale-while-revalidate=5", { fresh: 10, stale: 5 }],
    ["Public, S-Maxage=10", { fresh: 10, stale: 0 }],
  ])("keeps %s for %j", (cacheControl, policy) => {
    expect(edgePolicy(cacheControl)).toEqual(policy);
  });

  test.each([
    [CacheControl.failure],
    [PrivateCacheControl.publicData],
    ["public, max-age=60"],
    ["public, s-maxage=0"],
    ["public, s-maxage=60, private"],
    ["public, s-maxage=60, no-cache"],
    [null],
  ])("never keeps %s", (cacheControl) => {
    expect(edgePolicy(cacheControl)).toBeUndefined();
  });
});

describe("freshness", () => {
  const policy = { fresh: 60, stale: 3600 };
  test.each([
    [0, "fresh"],
    [59.9, "fresh"],
    [60, "stale"],
    [3659.9, "stale"],
    [3660, "expired"],
  ] as const)("a copy %d seconds old is %s", (age, kind) => {
    expect(freshness(age, policy)).toBe(kind);
  });
});

describe("edgeKey", () => {
  const build = "site/0123456789abcdef";
  test("is the URL under the build and the visitor's mode", () => {
    expect(edgeKey(get("/people"), build)).toBe(
      `${site}/__edge/${build}/system/people`,
    );
    expect(edgeKey(get("/events?a=1"), build)).toBe(
      `${site}/__edge/${build}/system/events?a=1`,
    );
    expect(edgeKey(get("/", { cookie: "theme=dark" }), build)).toBe(
      `${site}/__edge/${build}/dark/`,
    );
    expect(edgeKey(get("/", { cookie: "other=1; theme=light" }), build)).toBe(
      `${site}/__edge/${build}/light/`,
    );
  });

  test("reads the cookie as the page does: escapes decoded, the first of a repeated name", () => {
    expect(edgeKey(get("/", { cookie: "theme=%6Cight" }), build)).toBe(
      `${site}/__edge/${build}/light/`,
    );
    expect(
      edgeKey(get("/", { cookie: "theme=dark; theme=light" }), build),
    ).toBe(`${site}/__edge/${build}/dark/`);
  });

  test("reads a mode it doesn't know as the system's, as pages do", () => {
    expect(edgeKey(get("/", { cookie: "theme=sepia" }), build)).toBe(
      edgeKey(get("/"), build),
    );
  });
});

describe("the edge cache", () => {
  test("builds a page once, then serves it from the cache, with how in Server-Timing", async () => {
    const { fetch, app } = setup();
    const first = await fetch(get("/"));
    expect(state(first.response)).toBe("miss");
    expect(first.response.headers.get("server-timing")).toMatch(
      /^cache;desc="miss";dur=\d+\.\d, db;dur=40\.0$/,
    );
    const second = await fetch(get("/"));
    expect(state(second.response)).toBe("hit");
    expect(second.body).toBe(first.body);
    // A hit says nothing of the database it never reached.
    expect(second.response.headers.get("server-timing")).not.toContain("db");
    expect(app.calls()).toBe(1);
  });

  test("tells visitors what the page said, and keeps its own notes to itself", async () => {
    const { fetch } = setup();
    await fetch(get("/"));
    const { response } = await fetch(get("/"));
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(
      [...response.headers.keys()].filter((name) => name.startsWith("x-edge")),
    ).toEqual([]);
  });

  test("compresses each copy for the visitor it is served to", async () => {
    const { fetch } = setup();
    await fetch(get("/"));
    const br = await fetch(get("/"));
    expect(br.response.headers.get("content-encoding")).toBe("br");
    const gzip = await fetch(get("/", { "accept-encoding": "gzip" }));
    expect(gzip.response.headers.get("content-encoding")).toBe("gzip");
    const plain = await fetch(get("/", { "accept-encoding": "identity" }));
    expect(plain.response.headers.get("content-encoding")).toBeNull();
    expect(plain.body).toBe(br.body);
  });

  test("keeps each mode's copy apart, a fixed mode by the lifetimes its page names", async () => {
    const { fetch, app } = setup((request) =>
      request.headers.get("cookie") === null
        ? {}
        : {
            cacheControl: PrivateCacheControl.publicData,
            headers: { [edgeCacheControlHeader]: CacheControl.publicData },
          },
    );
    const system = await fetch(get("/"));
    const night = await fetch(get("/", { cookie: "theme=dark" }));
    expect(state(night.response)).toBe("miss");
    expect(night.body).not.toBe(system.body);
    const nightAgain = await fetch(get("/", { cookie: "theme=dark" }));
    expect(state(nightAgain.response)).toBe("hit");
    expect(nightAgain.body).toBe(night.body);
    // Still private to whoever gets it.
    expect(nightAgain.response.headers.get("cache-control")).toBe(
      PrivateCacheControl.publicData,
    );
    const systemAgain = await fetch(get("/"));
    expect(systemAgain.body).toBe(system.body);
    expect(app.calls()).toBe(2);
  });

  test("serves a stale copy at once and rebuilds it after the response, once", async () => {
    const { fetch, time, app } = setup();
    const first = await fetch(get("/"));
    time.advance(301);
    const stale = await fetch(get("/"));
    expect(state(stale.response)).toBe("stale");
    expect(stale.body).toBe(first.body);
    expect(app.calls()).toBe(2);
    const fresh = await fetch(get("/"));
    expect(state(fresh.response)).toBe("hit");
    expect(fresh.body).toBe("<p>build 2 for no cookie</p>");
  });

  test("rebuilds a copy too old to serve before answering", async () => {
    const { fetch, time } = setup();
    await fetch(get("/"));
    time.advance(300 + 3600);
    const expired = await fetch(get("/"));
    expect(state(expired.response)).toBe("miss");
    expect(expired.body).toBe("<p>build 2 for no cookie</p>");
  });

  test("keeps not found for a minute, never stale", async () => {
    const { fetch, time, app } = setup(() => ({
      status: 404,
      cacheControl: CacheControl.notFound,
    }));
    await fetch(get("/nothing"));
    const again = await fetch(get("/nothing"));
    expect(state(again.response)).toBe("hit");
    expect(again.response.status).toBe(404);
    time.advance(60);
    const later = await fetch(get("/nothing"));
    expect(state(later.response)).toBe("miss");
    expect(app.calls()).toBe(2);
  });

  test.each([
    ["a failure", { status: 503, cacheControl: CacheControl.failure }],
    ["a private page", { cacheControl: PrivateCacheControl.publicData }],
    ["a redirect", { status: 303, cacheControl: CacheControl.publicData }],
    [
      "a page that sets a cookie",
      { headers: { "set-cookie": "theme=dark; Path=/" } },
    ],
  ] as const)("never keeps %s", async (_, page) => {
    const { fetch, memory, app } = setup(() => page);
    await fetch(get("/"));
    await fetch(get("/"));
    expect(memory.entries.size).toBe(0);
    expect(app.calls()).toBe(2);
  });

  test("passes anything but a GET straight through", async () => {
    const { fetch, memory } = setup();
    const { response } = await fetch(
      new Request(`${site}/mcp`, { method: "POST", body: "{}" }),
    );
    expect(state(response)).toBe("bypass");
    expect(memory.entries.size).toBe(0);
  });

  test("lets the page answer a client that refuses every coding", async () => {
    const { fetch, app } = setup();
    await fetch(get("/"));
    const { response } = await fetch(get("/", { "accept-encoding": "*;q=0" }));
    expect(state(response)).toBe("bypass");
    expect(app.calls()).toBe(2);
  });

  test("answers from the page when the cache can't be reached", async () => {
    const app = handler(() => ({}));
    const broken: ResponseCache = {
      match: () => Promise.reject(new Error("no cache")),
      put: () => Promise.reject(new Error("no cache")),
    };
    const ctx = context();
    const serve = edgeCached(app.handle, {
      cache: broken,
      build: "site/x",
      now: Date.now,
    });
    const response = await serve(get("/"), ctx);
    await ctx.settle();
    expect(response.status).toBe(200);
    expect(state(response)).toBe("miss");
  });
});

describe("photo variants", () => {
  test("keep their own cache: the page cache leaves /img/ alone", async () => {
    const { fetch, memory, app } = setup(() => ({
      cacheControl: "public, max-age=31536000, immutable",
      headers: { "server-timing": 'img;desc="hit";dur=2' },
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response } = await fetch(get("/img/w640/avif/1/events/a.jpg"));
      expect(response.headers.get("server-timing")).toBe(
        'img;desc="hit";dur=2',
      );
    }
    expect(memory.entries.size).toBe(0);
    expect(app.calls()).toBe(2);
  });
});
