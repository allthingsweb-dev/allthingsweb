import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl } from "../src/cache.ts";
import { ogCards } from "../src/og/cards.ts";
import { eventDatabase, slugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * Link-preview cards and QR codes, served by the Worker in workerd against
 * the event catalog. Alchemy's local Images binding draws no text, so an
 * event's card falls back to the site's here; drawing it is checked on a
 * deployed preview (the PR has samples).
 */

const origin = "https://allthings.dev";
const database = await serve(await eventDatabase(new Date()));

const Stack = testStack("allthings-web-og-test", {
  Cards: { ORIGIN: origin, DATABASE_URL: database.url, IMAGES: true },
  NoImages: { ORIGIN: origin, DATABASE_URL: database.url },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
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

  it("send the site's card, never kept, when the event's can't be drawn", async ({
    Cards,
    NoImages,
  }) => {
    for (const url of [Cards, NoImages]) {
      const { response } = await get(`${url}/og/${slugs.past}.png`);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(ogCards.home.src);
      expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    }
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
