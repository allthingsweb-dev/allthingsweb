import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl, immutable } from "../src/cache.ts";
import { contentSecurityPolicy } from "../src/pages/response.ts";
import { catalogDatabase } from "./support/catalog.ts";
import { dimensions, png, serveMedia } from "./support/media.ts";
import {
  gzipped,
  htmlBudget,
  htmlProblems,
  subresources,
} from "./support/pages.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * Image variants, made in workerd by the local Images binding (Sharp) from
 * originals on a stand-in media origin, and the pages that offer them. Every
 * image row in the catalog was last changed at 2026-01-02T03:04:05Z, so
 * every photo's version is 1767323045.
 */

const origin = "https://allthings.dev";
const version = "1767323045";
/**
 * A version no page names, and no earlier run used: the local edge cache
 * outlives a run, so variants under it are made afresh.
 */
const fresh = String(Date.now() % 1e12);

const db = await catalogDatabase(new Date(), true);
await db.exec("UPDATE images SET updated_at = '2026-01-02T03:04:05Z'");
const database = await serve(db);

const media = serveMedia({
  "events/home/effect.jpg": { body: png(1600, 1200), type: "image/png" },
  "events/home/pier-70.jpg": { body: png(1200, 900), type: "image/png" },
  "events/home/mux.jpg": { body: png(1024, 768), type: "image/png" },
  "profiles/erik.jpg": { body: png(2160, 2160), type: "image/png" },
  "events/home/broken.jpg": { body: "not an image", type: "image/jpeg" },
  // Over the 20 MB the Images binding reads.
  "events/home/huge.png": {
    body: new Uint8Array(20_000_001),
    type: "image/png",
  },
  "events/home/page.jpg": { body: "<!doctype html>", type: "text/html" },
  "events/home/moved.jpg": {
    body: "",
    type: "text/plain",
    status: 302,
    location: "https://elsewhere.example/a.jpg",
  },
});

const Stack = testStack("allthings-web-images-test", {
  Variants: {
    ORIGIN: origin,
    DATABASE_URL: database.url,
    MEDIA_ORIGIN: media.origin,
    IMAGES: true,
  },
  Originals: {
    ORIGIN: origin,
    DATABASE_URL: database.url,
    MEDIA_ORIGIN: media.origin,
  },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(
    Effect.ensuring(
      Effect.promise(async () => {
        await media.stop();
        await database.stop();
      }),
    ),
  ),
);

type Worker = "Variants" | "Originals";

/** A test that gets the running Workers' URLs. */
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
        return run({ Variants: url("Variants"), Originals: url("Originals") });
      }),
    ),
  );

/** GET `path`, and its body. */
const get = async (url: string, path: string) => {
  const response = await fetch(`${url}${path}`);
  return { response, body: new Uint8Array(await response.arrayBuffer()) };
};

/** Every URL a page's srcsets and srcs name. */
const imageUrls = (html: string): Array<string> =>
  [...html.matchAll(/<(?:img|source) [^>]*>/g)].flatMap(([tag]) => [
    ...[...tag.matchAll(/ src="([^"]+)"/g)].map(([, src]) => src ?? ""),
    ...[...tag.matchAll(/ srcset="([^"]+)"/g)].flatMap(([, srcset]) =>
      (srcset ?? "")
        .split(", ")
        .map((candidate) => candidate.split(" ")[0] ?? ""),
    ),
  ]);

describe("/ with variants", () => {
  it("allows images from this site alone, and loads nothing from elsewhere", async ({
    Variants,
  }) => {
    const response = await fetch(`${Variants}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.variants,
    );
    expect(contentSecurityPolicy.variants).toContain("img-src 'self';");
    for (const path of [...subresources(html), ...imageUrls(html)]) {
      expect(path).toMatch(/^\/(?!\/)/);
    }
    expect(html).not.toContain("media.allthings.dev");
  });

  it("offers the mosaic's photos as variants of the widths each has, at its own size", async ({
    Variants,
  }) => {
    const html = await (await fetch(`${Variants}/`)).text();
    const tiles =
      /<div class="mosaic tiles-3">(.*?)<\/div>/
        .exec(html)?.[1]
        ?.match(/<picture>.*?<\/picture>/g) ?? [];
    expect(tiles).toHaveLength(3);
    const widthsOf = (tile: string, format: string) =>
      [
        ...(
          new RegExp(`type="image/${format}" srcset="([^"]+)"`).exec(
            tile,
          )?.[1] ?? ""
        ).matchAll(/ (\d+)w/g),
      ].map(([, width]) => Number(width));
    const [effect = "", pier70 = "", mux = ""] = tiles;
    expect(widthsOf(effect, "avif")).toEqual([240, 360, 480, 720, 960, 1200]);
    expect(widthsOf(pier70, "webp")).toEqual([240, 360, 480, 720, 960, 1200]);
    expect(widthsOf(mux, "avif")).toEqual([240, 360, 480, 720, 960]);
    expect(effect).toContain(
      `<img src="/img/480/jpeg/${version}/events/home/effect.jpg" srcset="/img/240/jpeg/${version}/events/home/effect.jpg 240w,`,
    );
    expect(effect).toContain(
      'alt="Michael Arnaldi on stage at CodeRabbit" width="1600" height="1200"',
    );
    expect(mux).toContain('alt="Pizza at Mux" width="1024" height="768"');
  });

  it("signs off with Erik's portrait at 36 and 72 pixels", async ({
    Variants,
  }) => {
    const html = await (await fetch(`${Variants}/`)).text();
    expect(html).toContain(
      `<source type="image/avif" srcset="/img/36x36/avif/${version}/profiles/erik.jpg 1x, /img/72x72/avif/${version}/profiles/erik.jpg 2x"/>`,
    );
  });

  it(`is valid HTML and gzips to at most ${htmlBudget} bytes`, async ({
    Variants,
  }) => {
    const html = await (await fetch(`${Variants}/`)).text();
    expect(await htmlProblems(html)).toEqual([]);
    expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
  });

  it("names only variants that exist, each in its format, at its size, cached for good", async ({
    Variants,
  }) => {
    const html = await (await fetch(`${Variants}/`)).text();
    const urls = [...new Set(imageUrls(html))].filter((url) =>
      url.startsWith("/img/"),
    );
    // 3 photos: 6, 6 and 5 widths; Erik: 2 squares; 3 formats each.
    expect(urls).toHaveLength((6 + 6 + 5 + 2) * 3);
    const originals: Record<string, number> = {
      "events/home/effect.jpg": 1600,
      "events/home/pier-70.jpg": 1200,
      "events/home/mux.jpg": 1024,
      "profiles/erik.jpg": 2160,
    };
    for (const url of urls) {
      const [, size = "", format = "", , ...key] = url.split("/").slice(1);
      const { response, body } = await get(Variants, url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(`image/${format}`);
      expect(response.headers.get("cache-control")).toBe(immutable);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const side = /^(\d+)x\1$/.exec(size)?.[1];
      const width = Number(side ?? size);
      const original = originals[key.join("/")] ?? 0;
      // A width is never enlarged; local squares fit inside their box.
      expect(dimensions(body)?.width).toBe(Math.min(width, original));
      if (side !== undefined) expect(dimensions(body)?.height).toBe(width);
    }
  });
});

describe("/img/", () => {
  it("makes a variant once, from the original, then serves it from the edge cache", async ({
    Variants,
  }) => {
    const path = `/img/360/webp/${fresh}/events/home/mux.jpg`;
    const before = media.fetches("events/home/mux.jpg");
    const first = await get(Variants, path);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get("server-timing")).toMatch(
      /^img;desc="miss";dur=\d+$/,
    );
    expect(media.fetches("events/home/mux.jpg")).toBe(before + 1);
    const second = await get(Variants, path);
    expect(second.response.status).toBe(200);
    expect(second.response.headers.get("server-timing")).toBe('img;desc="hit"');
    expect(second.response.headers.get("cache-control")).toBe(immutable);
    expect(second.response.headers.get("content-type")).toBe("image/webp");
    expect(second.body).toEqual(first.body);
    expect(dimensions(second.body)).toEqual({ width: 360, height: 270 });
    expect(media.fetches("events/home/mux.jpg")).toBe(before + 1);
  });

  it("is one entry in the cache whatever the query", async ({ Variants }) => {
    const path = `/img/240/avif/${fresh}/events/home/mux.jpg`;
    const before = media.fetches("events/home/mux.jpg");
    await get(Variants, `${path}?a=1`);
    const again = await get(Variants, `${path}?b=2`);
    expect(again.response.headers.get("server-timing")).toBe('img;desc="hit"');
    expect(media.fetches("events/home/mux.jpg")).toBe(before + 1);
  });

  for (const path of [
    "/img/500/webp/1/events/home/mux.jpg",
    "/img/36/webp/1/events/home/mux.jpg",
    "/img/480x480/webp/1/events/home/mux.jpg",
    "/img/480/png/1/events/home/mux.jpg",
    "/img/480/webp/latest/events/home/mux.jpg",
    "/img/480/webp/1/events/home/..%2f..%2fprofiles/erik.jpg",
    "/img/480/webp/1/events/home/%2e%2e%2fmux.jpg",
    "/img/480/webp/1/events%2Fhome%2Fmux.jpg",
    "/img/480/webp/1/events//home/mux.jpg",
    "/img/480/webp/1/https:/elsewhere.example/a.jpg",
    "/img/480/webp/1/events/home/mux.svg",
    "/img/480/webp/1/events/home/m%75x.jpg",
    "/img/480/webp/1",
  ]) {
    it(`is not found, and fetches nothing, at ${path}`, async ({
      Variants,
    }) => {
      const before = media.requests.length;
      const { response } = await get(Variants, path);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe(CacheControl.notFound);
      expect(media.requests.length).toBe(before);
    });
  }

  it("resolves dot segments before it routes, so they never leave the media origin's keys", async ({
    Variants,
  }) => {
    const before = media.requests.length;
    // URLs resolve "%2e%2e" as "..": this is /secrets.jpg, no variant.
    const { response } = await get(
      Variants,
      "/img/480/webp/1/events/home/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/secrets.jpg",
    );
    expect(response.status).toBe(404);
    expect(media.requests.length).toBe(before);
  });

  it("is not found when the media origin has no such photo", async ({
    Variants,
  }) => {
    const { response } = await get(
      Variants,
      "/img/480/webp/1/events/home/gone.jpg",
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(CacheControl.notFound);
    expect(media.fetches("events/home/gone.jpg")).toBe(1);
  });

  it("sends the original, briefly, when it can't make the variant, and tries again next time", async ({
    Variants,
  }) => {
    const path = "/img/480/webp/1/events/home/broken.jpg";
    for (const attempt of [1, 2]) {
      const { response, body } = await get(Variants, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new TextDecoder().decode(body)).toBe("not an image");
      // Images read the first copy; the original is fetched again to send.
      expect(media.fetches("events/home/broken.jpg")).toBe(attempt * 2);
    }
  });

  it("sends an original over the binding's input limit as it is, without trying", async ({
    Variants,
  }) => {
    const { response, body } = await get(
      Variants,
      "/img/480/webp/1/events/home/huge.png",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("server-timing")).toBe('img;desc="original"');
    expect(body.byteLength).toBe(20_000_001);
    expect(media.fetches("events/home/huge.png")).toBe(1);
  });

  it("never sends anything but an image from the media origin", async ({
    Variants,
  }) => {
    const { response, body } = await get(
      Variants,
      "/img/480/webp/1/events/home/page.jpg",
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(new TextDecoder().decode(body)).not.toContain("doctype");
  });

  it("doesn't follow the media origin's redirects", async ({ Variants }) => {
    const { response } = await get(
      Variants,
      "/img/480/webp/1/events/home/moved.jpg",
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
  });

  it("sends originals, briefly, from a Worker without the Images binding", async ({
    Originals,
  }) => {
    const { response, body } = await get(
      Originals,
      "/img/480/webp/1/events/home/mux.jpg",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(dimensions(body)).toBeUndefined();
    expect(body).toEqual(png(1024, 768));
  });
});

describe("/people with variants", () => {
  it("offers the organizers' portraits as squares from this site alone", async ({
    Variants,
  }) => {
    const response = await fetch(`${Variants}/people`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.variants,
    );
    expect(html).toContain(
      `<img class="portrait" src="/img/160x160/jpeg/${version}/profiles/erik.jpg" srcset="/img/160x160/jpeg/${version}/profiles/erik.jpg 160w, /img/320x320/jpeg/${version}/profiles/erik.jpg 320w"`,
    );
    for (const path of [...subresources(html), ...imageUrls(html)]) {
      expect(path).toMatch(/^\/(?!\/)/);
    }
    const { response: variant, body } = await get(
      Variants,
      `/img/320x320/webp/${version}/profiles/erik.jpg`,
    );
    expect(variant.status).toBe(200);
    expect(dimensions(body)).toEqual({ width: 320, height: 320 });
  });
});

describe("/ without variants", () => {
  it("links the originals, which only its policy allows", async ({
    Originals,
  }) => {
    const response = await fetch(`${Originals}/`);
    const html = await response.text();
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.originals,
    );
    expect(html).toContain(
      '<img src="https://media.allthings.dev/events/home/effect.jpg" alt="Michael Arnaldi on stage at CodeRabbit"',
    );
    expect(html).not.toContain("/img/");
  });
});
