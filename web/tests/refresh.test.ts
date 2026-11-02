import { describe, expect, test } from "bun:test";
import {
  type PageNamespace,
  parsePointer,
  refreshSite,
  type SitePointer,
  siteKey,
} from "../src/page-store.ts";
import {
  prewarmPath,
  prewarmRequest,
  refreshPath,
  refreshRequest,
} from "../src/refresh.ts";
import { tellSite } from "../src/sync/worker.ts";

/**
 * How the writers tell the site its data changed: the endpoint, the store's
 * refresh behind it, and the sync's call to it.
 */

const token = "a-test-token-that-is-long-enough";
const pointer: SitePointer = {
  checkedAt: Date.UTC(2026, 10, 1, 23, 0),
  current: { version: "v1", boundaries: [] },
  next: { version: "v2", boundaries: [], from: Date.UTC(2026, 10, 1, 23, 1) },
};

const post = (headers: Record<string, string> = {}, method = "POST") =>
  new Request(`https://allthings.dev${refreshPath}`, { method, headers });

describe("the refresh endpoint", () => {
  test("isn't there without a token", async () => {
    const response = await refreshRequest(
      post({ authorization: `Bearer ${token}` }),
      undefined,
      async () => pointer,
    );
    expect(response.status).toBe(404);
  });

  test("isn't there with a blank token either, so no known value opens it", async () => {
    const response = await refreshRequest(
      post({ authorization: "Bearer    " }),
      "   ",
      async () => pointer,
    );
    expect(response.status).toBe(404);
  });

  test("takes only a POST", async () => {
    const response = await refreshRequest(
      post({ authorization: `Bearer ${token}` }, "GET"),
      token,
      async () => pointer,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  test.each([
    ["no Authorization", {}],
    ["another token", { authorization: "Bearer another" }],
    ["the token without Bearer", { authorization: token }],
  ] as const)("refuses %s, and refreshes nothing", async (_, headers) => {
    let refreshed = 0;
    const response = await refreshRequest(post(headers), token, async () => {
      refreshed += 1;
      return pointer;
    });
    expect(response.status).toBe(401);
    expect(refreshed).toBe(0);
  });

  test("refreshes with the token, and answers with the version and the next one, never stored", async () => {
    const response = await refreshRequest(
      post({ authorization: `Bearer ${token}` }),
      token,
      async () => pointer,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      checkedAt: "2026-11-01T23:00:00.000Z",
      version: "v1",
      next: { version: "v2", from: "2026-11-01T23:01:00.000Z" },
    });
  });

  test("says so when the version can't be read", async () => {
    const response = await refreshRequest(
      post({ authorization: `Bearer ${token}` }),
      token,
      () => Promise.reject(new Error("Neon is down")),
    );
    expect(response.status).toBe(503);
  });
});

describe("the prewarm endpoint", () => {
  const report = {
    paths: 3,
    kept: 1,
    built: 2,
    passed: 0,
    failed: [],
    sitemapRead: true,
    waitedMs: 0,
  };

  test("takes the same token, and answers with what it did", async () => {
    const at = (headers: Record<string, string>) =>
      new Request(`https://allthings.dev${prewarmPath}`, {
        method: "POST",
        headers,
      });
    expect(
      (await prewarmRequest(at({}), undefined, async () => report)).status,
    ).toBe(404);
    let warmed = 0;
    const refused = await prewarmRequest(
      at({ authorization: "Bearer another" }),
      token,
      async () => {
        warmed += 1;
        return report;
      },
    );
    expect(refused.status).toBe(401);
    expect(warmed).toBe(0);
    const done = await prewarmRequest(
      at({ authorization: `Bearer ${token}` }),
      token,
      async () => report,
    );
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual(report);
    const noSitemap = await prewarmRequest(
      at({ authorization: `Bearer ${token}` }),
      token,
      async () => ({
        ...report,
        paths: 1,
        failed: ["/sitemap.xml"],
        sitemapRead: false,
      }),
    );
    expect(noSitemap.status).toBe(503);
    expect(await noSitemap.json()).toMatchObject({ failed: ["/sitemap.xml"] });
    const failed = await prewarmRequest(
      at({ authorization: `Bearer ${token}` }),
      token,
      () => Promise.reject(new Error("KV is unreachable")),
    );
    expect(failed.status).toBe(503);
  });
});

describe("refreshSite", () => {
  const namespace = (initial?: SitePointer) => {
    const entries = new Map<string, string>();
    if (initial !== undefined) entries.set(siteKey, JSON.stringify(initial));
    let unreachable = false;
    const pages: PageNamespace = {
      get: async (key) => {
        if (unreachable) throw new Error("KV is unreachable");
        const value = entries.get(key);
        return value === undefined
          ? null
          : new TextEncoder().encode(value).buffer;
      },
      put: async (key, value) => {
        entries.set(
          key,
          typeof value === "string" ? value : new TextDecoder().decode(value),
        );
      },
    };
    return {
      pages,
      stored: () => parsePointer(entries.get(siteKey) ?? ""),
      breaks: () => {
        unreachable = true;
      },
    };
  };

  test("reads the version now and waits out the turnover for a new one", async () => {
    const kv = namespace({
      checkedAt: 0,
      current: { version: "v1", boundaries: [] },
    });
    const next = await refreshSite({
      pages: kv.pages,
      now: () => 1_000,
      siteState: async () => ({ version: "v2", boundaries: [5] }),
      turnover: 75_000,
    });
    expect(next).toEqual({
      checkedAt: 1_000,
      current: { version: "v1", boundaries: [] },
      next: { version: "v2", boundaries: [5], from: 76_000 },
    });
    expect(kv.stored()).toEqual(next);
  });

  test("writes nothing when the pointer can't be read", async () => {
    const kv = namespace(pointer);
    kv.breaks();
    await expect(
      refreshSite({
        pages: kv.pages,
        now: () => 1_000,
        siteState: async () => ({ version: "v3", boundaries: [] }),
        turnover: 0,
      }),
    ).rejects.toThrow("KV is unreachable");
  });
});

describe("tellSite", () => {
  const logged = () => {
    const lines: Array<Readonly<Record<string, unknown>>> = [];
    return {
      lines,
      log: (entry: Readonly<Record<string, unknown>>) => lines.push(entry),
    };
  };

  test("posts to the site's refresh path with the token, then has it prewarm, and logs what each said", async () => {
    const requests: Array<Request> = [];
    const { lines, log } = logged();
    await tellSite(
      {
        SITE: {
          fetch: async (request: Request) => {
            requests.push(request);
            return Response.json({ version: "v1", next: null });
          },
        },
        SITE_REFRESH_TOKEN: token,
      },
      log,
    );
    expect(
      requests.map((request) => [
        request.method,
        new URL(request.url).pathname,
      ]),
    ).toEqual([
      ["POST", refreshPath],
      ["POST", prewarmPath],
    ]);
    for (const request of requests) {
      expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    }
    expect(lines).toEqual([
      expect.objectContaining({
        source: "luma-sync",
        step: "site",
        status: "done",
        http: 200,
        version: "v1",
      }),
      expect.objectContaining({
        source: "luma-sync",
        step: "prewarm",
        status: "done",
        http: 200,
      }),
    ]);
  });

  test("logs a refusal or a failure, and never throws", async () => {
    const { lines, log } = logged();
    await tellSite(
      {
        SITE: {
          fetch: async () =>
            Response.json({ error: "unauthorized" }, { status: 401 }),
        },
        SITE_REFRESH_TOKEN: token,
      },
      log,
    );
    await tellSite(
      {
        SITE: { fetch: () => Promise.reject(new Error("no route")) },
        SITE_REFRESH_TOKEN: token,
      },
      log,
    );
    expect(lines.map((line) => [line["status"], line["http"]])).toEqual([
      ["failed", 401],
      ["failed", undefined],
    ]);
  });

  test("gives up on a site that doesn't answer in time, cancels its request, and logs it", async () => {
    const { lines, log } = logged();
    const sent: Array<Request> = [];
    await tellSite(
      {
        SITE: {
          fetch: (request: Request) => {
            sent.push(request);
            return new Promise<Response>(() => undefined);
          },
        },
        SITE_REFRESH_TOKEN: token,
      },
      log,
      { site: 20, prewarm: 20 },
    );
    await tellSite(
      {
        SITE: {
          fetch: async (request: Request) => {
            sent.push(request);
            return new Response(new ReadableStream({ start: () => undefined }));
          },
        },
        SITE_REFRESH_TOKEN: token,
      },
      log,
      { site: 20, prewarm: 20 },
    );
    expect(lines.map((line) => [line["status"], line["reason"]])).toEqual([
      ["failed", "Error: the site didn't answer within 20 ms"],
      ["failed", "Error: the site didn't answer within 20 ms"],
    ]);
    expect(sent.map((request) => request.signal.aborted)).toEqual([true, true]);
  });

  test("skips without the binding or the token, and says so", async () => {
    const { lines, log } = logged();
    await tellSite({ SITE_REFRESH_TOKEN: token }, log);
    await tellSite({ SITE: { fetch: async () => new Response() } }, log);
    expect(lines.map((line) => line["status"])).toEqual(["skipped", "skipped"]);
  });
});
