import { describe, expect, it } from "bun:test";
import {
  CacheControl,
  PrivateCacheControl,
  forWorkersCache,
  immutable,
  preferenceCacheControl,
  purgeSiteData,
  siteDataTag,
  type WorkersCachePurge,
  workersCacheHeader,
  workersCacheLifetime,
} from "../src/cache.ts";

const get = new Request("https://allthings.dev/events");

const answer = (headers: Record<string, string>, status = 200) =>
  new Response("body", { status, headers });

const edge = (response: Response, request = get) =>
  forWorkersCache(request, response).headers.get(workersCacheHeader);

describe("forWorkersCache", () => {
  it("keeps public pages and reads for the short edge lifetime", () => {
    for (const cacheControl of [
      CacheControl.publicData,
      CacheControl.page,
      CacheControl.notFound,
    ]) {
      expect(edge(answer({ "cache-control": cacheControl }))).toBe(
        workersCacheLifetime,
      );
    }
    expect(edge(answer({ "cache-control": CacheControl.notFound }, 404))).toBe(
      workersCacheLifetime,
    );
  });

  it("leaves what never changes under its URL to its own year", () => {
    const response = forWorkersCache(
      get,
      answer({ "cache-control": immutable }),
    );
    expect(response.headers.has(workersCacheHeader)).toBe(false);
  });

  it("keeps nothing else at the edge", () => {
    for (const headers of [
      { "cache-control": PrivateCacheControl.publicData },
      { "cache-control": CacheControl.failure },
      { "cache-control": preferenceCacheControl },
      { "cache-control": "public, max-age=60" },
      {},
      { "cache-control": CacheControl.publicData, "set-cookie": "theme=dark" },
    ]) {
      expect(edge(answer(headers))).toBe("no-store");
    }
  });

  it("treats HEAD as GET, and passes other methods untouched", () => {
    const head = new Request(get, { method: "HEAD" });
    expect(edge(answer({ "cache-control": CacheControl.page }), head)).toBe(
      workersCacheLifetime,
    );
    const post = new Request(get, { method: "POST", body: "{}" });
    const response = answer({ "cache-control": CacheControl.publicData });
    expect(forWorkersCache(post, response)).toBe(response);
  });

  it("keeps the status, body and every other header", async () => {
    const response = forWorkersCache(
      get,
      answer(
        {
          "cache-control": CacheControl.publicData,
          vary: "accept-encoding, cookie",
          "content-type": "text/html; charset=utf-8",
        },
        404,
      ),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("body");
    expect(response.headers.get("vary")).toBe("accept-encoding, cookie");
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
  });
});

describe("the site's data in Workers Cache", () => {
  it("tags what can change with the data, and nothing immutable or private", () => {
    const tagOf = (headers: Record<string, string>) =>
      forWorkersCache(get, answer(headers)).headers.get("cache-tag");
    expect(tagOf({ "cache-control": CacheControl.publicData })).toBe(
      siteDataTag,
    );
    expect(tagOf({ "cache-control": CacheControl.page })).toBe(siteDataTag);
    expect(tagOf({ "cache-control": immutable })).toBeNull();
    expect(tagOf({ "cache-control": PrivateCacheControl.page })).toBeNull();
    expect(tagOf({ "cache-control": CacheControl.failure })).toBeNull();
  });

  it("purges that tag, and says how it went without throwing", async () => {
    const asked: Array<ReadonlyArray<string>> = [];
    const cache = (
      outcome: "ok" | "refused" | "throws",
    ): WorkersCachePurge => ({
      purge: async ({ tags }) => {
        asked.push(tags);
        if (outcome === "throws") throw new Error("rate limited");
        return { success: outcome === "ok" };
      },
    });
    expect(await purgeSiteData(cache("ok"))).toBe("purged");
    expect(await purgeSiteData(cache("refused"))).toBe("failed");
    expect(await purgeSiteData(cache("throws"))).toBe("failed");
    expect(await purgeSiteData(undefined)).toBe("unavailable");
    expect(asked).toEqual([[siteDataTag], [siteDataTag], [siteDataTag]]);
  });
});
