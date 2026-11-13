import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl } from "../src/cache.ts";
import { built } from "../src/assets.ts";
import { ogCards } from "../src/og/cards.ts";
import { eventDatabase, slugs } from "./support/event-catalog.ts";
import { dimensions, png, serveMedia } from "./support/media.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * Link-preview cards and QR codes, served by the Worker in workerd against
 * the event catalog. Alchemy's local Images binding rasterizes text but
 * skips draws, so a card drawn here is its ground alone: what the words
 * look like is checked on a deployed preview (the PR has samples). Ada's
 * photo is on a stand-in media origin; Grace has none.
 */

const origin = "https://allthings.dev";
const catalog = await eventDatabase(new Date());
// A slug Ada had before, which her card's address still answers.
await catalog.exec(
  "INSERT INTO profile_slugs (slug, profile_id) VALUES ('ada-byron', 'b0000000-0000-4000-8000-000000000501')",
);
const database = await serve(catalog);
const media = serveMedia({
  "profiles/ada.jpg": { body: png(400, 400), type: "image/png" },
});

const Stack = testStack("allthings-web-og-test", {
  Cards: {
    ORIGIN: origin,
    DATABASE_URL: database.url,
    IMAGES: true,
    MEDIA_ORIGIN: media.origin,
  },
  NoImages: { ORIGIN: origin, DATABASE_URL: database.url },
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
        await database.stop();
        await media.stop();
      }),
    ),
  ),
);

type Worker = "Cards" | "NoImages";

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
        return run({ Cards: url("Cards"), NoImages: url("NoImages") });
      }),
    ),
  );

const get = async (url: string) => {
  const response = await fetch(url, { redirect: "manual" });
  return { response, body: new Uint8Array(await response.arrayBuffer()) };
};

describe("pages' cards", () => {
  it("name their card, absolute on the origin, with X's large card", async ({
    Cards,
  }) => {
    const html = await (await fetch(`${Cards}/${slugs.past}`)).text();
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(image).toMatch(
      new RegExp(`^${origin}/og/${slugs.past}\\.png\\?v=[0-9a-z]+$`),
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image"/>',
    );
    expect(html).toContain(`<meta name="twitter:image" content="${image}"/>`);
    expect(html).toContain(
      '<meta property="og:image:type" content="image/png"/>',
    );
    const home = await (await fetch(`${Cards}/`)).text();
    expect(home).toContain(
      `<meta property="og:image" content="${origin}${ogCards.home.src}"/>`,
    );
  });

  it("serve the brand's card files", async ({ Cards }) => {
    const { response, body } = await get(`${Cards}${ogCards.home.src}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const view = new DataView(body.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
  });

  for (const [name, card] of [
    ["home", ogCards.home],
    ["people", ogCards.people],
    ["not-found", ogCards.notFound],
  ] as const) {
    it(`/og/${name}.png is the brand's card, at a URL that never changes`, async ({
      Cards,
    }) => {
      const { response } = await get(`${Cards}/og/${name}.png`);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(card.src);
    });
  }

  it("draw an event's card on its ground, kept a day", async ({ Cards }) => {
    const { response, body } = await get(`${Cards}/og/${slugs.past}.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    );
    const view = new DataView(body.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
  });

  it("send the site's card, never kept, when the event's can't be drawn", async ({
    NoImages,
  }) => {
    const { response } = await get(`${NoImages}/og/${slugs.past}.png`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(ogCards.home.src);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
  });

  for (const path of [
    "/og/no-such-evening.png",
    "/og/.png",
    "/og/home.jpg",
    "/og/%E0%A4%A.png",
  ]) {
    it(`${path} is not found`, async ({ Cards }) => {
      const { response } = await get(`${Cards}${path}`);
      expect(response.status).toBe(404);
    });
  }
});

describe("years' cards", () => {
  it("are named by each year's page, absolute on the origin", async ({
    Cards,
  }) => {
    const html = await (await fetch(`${Cards}/year/2025`)).text();
    expect(html).toMatch(
      new RegExp(
        `<meta property="og:image" content="${origin}/og/year/2025\\.png\\?v=[0-9a-z]+"/>`,
      ),
    );
  });

  it("draw a year's card on Night's ground, kept a day", async ({ Cards }) => {
    const { response, body } = await get(`${Cards}/og/year/2025.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    );
    const view = new DataView(body.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
  });

  it("send the year page's card file, never kept, when a year's can't be drawn", async ({
    NoImages,
  }) => {
    const { response } = await get(`${NoImages}/og/year/2025.png`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(ogCards.year.src);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
  });

  for (const path of [
    "/og/year/2099.png",
    "/og/year/25.png",
    "/og/year/2025.jpg",
    "/og/year/x.png",
  ]) {
    it(`${path} is not found`, async ({ Cards }) => {
      const { response } = await get(`${Cards}${path}`);
      expect(response.status).toBe(404);
    });
  }
});

describe("people's cards", () => {
  it("are named by each person's page; the people page keeps the brand's", async ({
    Cards,
  }) => {
    const html = await (await fetch(`${Cards}/people/ada-lovelace`)).text();
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(image).toMatch(
      new RegExp(`^${origin}/og/people/ada-lovelace\\.jpg\\?v=[0-9a-z]+$`),
    );
    expect(html).toContain(
      '<meta property="og:image:type" content="image/jpeg"/>',
    );
    expect(html).toContain(`<meta name="twitter:image" content="${image}"/>`);
    expect(html).toContain(
      '<meta property="og:image:alt" content="Ada Lovelace · Engineer, Analytical Engines · @ada · allthings/_"/>',
    );
    const people = await (await fetch(`${Cards}/people`)).text();
    expect(people).toContain(
      `<meta property="og:image" content="${origin}${ogCards.people.src}"/>`,
    );
    expect(people).toContain(
      '<meta property="og:image:type" content="image/png"/>',
    );
  });

  it("draw a person's card with their photo, kept a day", async ({ Cards }) => {
    const before = media.fetches("profiles/ada.jpg");
    const { response, body } = await get(`${Cards}/og/people/ada-lovelace.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(dimensions(body)).toEqual({ width: 1200, height: 630 });
    expect(media.fetches("profiles/ada.jpg")).toBe(before + 1);
  });

  it("draw one without a photo with the blank avatar, asking the media origin nothing", async ({
    Cards,
  }) => {
    const before = media.requests.length;
    const { response, body } = await get(`${Cards}/og/people/grace-hopper.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(dimensions(body)).toEqual({ width: 1200, height: 630 });
    expect(media.requests.length).toBe(before);
  });

  it("send the people card as a JPEG, never kept, when a person's can't be drawn", async ({
    NoImages,
  }) => {
    const { response } = await get(`${NoImages}/og/people/ada-lovelace.jpg`);
    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBe(built.og.cards.peopleJpeg.src);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    const fallback = await get(`${NoImages}${location}`);
    expect(fallback.response.headers.get("content-type")).toBe("image/jpeg");
    expect(dimensions(fallback.body)).toEqual({ width: 1200, height: 630 });
  });

  it("send a slug someone had before to their card's current version, never kept", async ({
    Cards,
  }) => {
    const html = await (await fetch(`${Cards}/people/ada-lovelace`)).text();
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    const { response } = await get(`${Cards}/og/people/ada-byron.jpg`);
    expect(response.status).toBe(302);
    expect(image).toBeDefined();
    expect(`${origin}${response.headers.get("location")}`).toBe(image ?? "");
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
  });

  for (const path of [
    "/og/people/no-such-person.jpg",
    "/og/people/.jpg",
    "/og/people/Ada-Lovelace.jpg",
    "/og/people/ada-lovelace.png",
    "/og/people/%E0%A4%A.jpg",
  ]) {
    it(`${path} is not found`, async ({ Cards }) => {
      const { response } = await get(`${Cards}${path}`);
      expect(response.status).toBe(404);
    });
  }
});

describe("QR codes", () => {
  it("draw a code to an event's page, as a PNG", async ({ Cards }) => {
    const { response, body } = await get(
      `${Cards}/api/v1/${slugs.past}/qr.png`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    expect(new TextDecoder("latin1").decode(body.subarray(1, 4))).toBe("PNG");
  });

  it("draw one to any page of the site, and refuse anywhere else", async ({
    Cards,
  }) => {
    const ok = await get(
      `${Cards}/api/v1/qr.png?url=${encodeURIComponent(`${origin}/events`)}`,
    );
    expect(ok.response.status).toBe(200);
    for (const url of [
      "",
      "?url=",
      `?url=${encodeURIComponent("https://elsewhere.example/a")}`,
      `?url=${encodeURIComponent(`${origin}.evil/a`)}`,
    ]) {
      const { response } = await get(`${Cards}/api/v1/qr.png${url}`);
      expect(response.status).toBe(400);
    }
  });

  it("is not found for an event there isn't", async ({ Cards }) => {
    const { response } = await get(`${Cards}/api/v1/no-such-evening/qr.png`);
    expect(response.status).toBe(404);
  });
});
