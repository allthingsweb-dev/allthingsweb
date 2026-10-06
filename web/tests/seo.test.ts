import { describe, expect } from "bun:test";
import { migratedDatabase } from "allthings-core/tests/support/database.ts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { CacheControl } from "../src/cache.ts";
import { sitePages } from "../src/seo/sitemap.ts";
import { catalog } from "./support/catalog.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * robots.txt, the sitemap and the RSS feed, served by the Worker in
 * workerd from the home page's catalog in PGlite, read over TCP as the
 * Worker reads Hyperdrive. Its published events get fixed timestamps and
 * one more, imported long after it happened, has a hostile name.
 *
 * Production is the host of `ORIGIN`. The local Workers answer on
 * localhost, a preview's host; a request that names the production host
 * in its Host header reaches the Worker as a request to production.
 */

const origin = "https://allthings.dev";

const db = await migratedDatabase();
await db.exec(catalog(new Date(), true));
await db.exec(`
  UPDATE events SET
    created_at = '2026-01-01T00:00:00Z',
    updated_at = '2026-02-01T00:00:00Z';
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_hackathon, program, is_draft, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000401', '2024-10-05-hackathon & more', '</title><item>Hack & tell</item>', 'Bring "<b>" ideas', '2024-10-05T16:00:00Z', '2024-10-06T02:00:00Z', 100, true, 'hackathon', false, '2026-09-16T00:00:00Z', '2026-09-17T00:00:00Z');
  -- Zoë judged the hackathon; Nobody took part in nothing, so has no entry.
  INSERT INTO profiles (id, name, title, bio, profile_type, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000901', 'Zoë Judge', '', '', 'member', '2026-09-18T00:00:00Z'),
    ('b0000000-0000-4000-8000-000000000902', 'Nobody', '', '', 'member', now());
  INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000401', 'b0000000-0000-4000-8000-000000000901', 'co-host', 0, 'site', now());
`);
const database = await serve(db);

const Stack = testStack("allthings-web-seo-test", {
  Site: { ORIGIN: origin, DATABASE_URL: database.url },
  // Nothing listens on the discard port, so every connection is refused.
  Unreachable: {
    ORIGIN: origin,
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:9/postgres",
  },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
);

type Worker = "Site" | "Unreachable";

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
        return run({ Site: url("Site"), Unreachable: url("Unreachable") });
      }),
    ),
  );

const get = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  return { response, body: await response.text() };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "url",
});

/** The published events, latest start first: the catalog's and the import. */
const published = [
  "later-typescript-ai-after-party",
  "then-js-trivia-night",
  "next-effect-sf",
  "2026-03-07-all-things-effect",
  "2025-11-02-pre-next-js-conf-ship-ai-meetup",
  "2025-06-01-react-bay-area-at-mux",
  "2025-01-28-all-things-web-at-sanity",
  "2024-10-05-hackathon & more",
];

describe("robots.txt", () => {
  it("lets crawlers in on the production host and names its sitemap", async (urls) => {
    const { response, body } = await get(`${urls.Site}/robots.txt`, {
      headers: { host: "allthings.dev" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("vary")).toBe("host");
    expect(body).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://allthings.dev/sitemap.xml\n",
    );
  });

  it("keeps crawlers out of every other host, even while its data can't be read", async (urls) => {
    for (const [url, host] of [
      [urls.Site, undefined],
      [urls.Site, "allthings-web-pr-93.allthings.workers.dev"],
      [urls.Site, "next.allthings.dev"],
      [urls.Unreachable, undefined],
    ] as const) {
      const { response, body } = await get(
        `${url}/robots.txt`,
        host === undefined ? {} : { headers: { host } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(CacheControl.page);
      expect(response.headers.get("vary")).toBe("host");
      expect(body).toBe("User-agent: *\nDisallow: /\n");
    }
  });
});

describe("/sitemap.xml", () => {
  it("lists the site's pages and every published event, latest first, never a draft", async (urls) => {
    const { response, body } = await get(`${urls.Site}/sitemap.xml`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(XMLValidator.validate(body)).toBe(true);
    const entries = (
      parser.parse(body) as {
        urlset: { url: Array<{ loc: string; lastmod?: string }> };
      }
    ).urlset.url;
    expect(entries.map((entry) => entry.loc)).toEqual([
      ...sitePages.map((path) => `${origin}${path}`),
      ...published.map((slug) => `${origin}/${encodeURIComponent(slug)}`),
      // Everyone who took part in a published evening has a page.
      `${origin}/people/zoe-judge`,
    ]);
    expect(body).not.toContain("draft");
    expect(body).not.toContain("/people/nobody");
    expect(entries.at(-2)?.lastmod).toBe("2026-09-17T00:00:00.000Z");
    expect(entries.at(-1)?.lastmod).toBe("2026-09-18T00:00:00.000Z");
    // The site's own pages have none; every event says when it changed.
    expect(entries.filter((entry) => entry.lastmod === undefined)).toHaveLength(
      sitePages.length,
    );
  });

  it("lists only pages the Worker serves", async (urls) => {
    for (const path of sitePages) {
      const { response } = await get(`${urls.Site}${path}`);
      expect(response.status).toBe(200);
    }
  });
});

describe("/rss", () => {
  it("is the feed of every published event, latest first, never a draft", async (urls) => {
    const { response, body } = await get(`${urls.Site}/rss`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(XMLValidator.validate(body)).toBe(true);
    const items = (
      parser.parse(body) as {
        rss: {
          channel: {
            item: Array<{ title: string; link: string; description: string }>;
          };
        };
      }
    ).rss.channel.item;
    expect(items.map((item) => item.link)).toEqual(
      published.map((slug) => `${origin}/${encodeURIComponent(slug)}`),
    );
    expect(body).not.toContain("Draft");
    expect(items.at(-1)).toMatchObject({
      title: "</title><item>Hack & tell</item>",
      description: 'Bring "<b>" ideas',
    });
    expect(body).toContain("<pubDate>Sat, 05 Oct 2024 16:00:00 GMT</pubDate>");
    expect(body).toContain(
      "<lastBuildDate>Thu, 17 Sep 2026 00:00:00 GMT</lastBuildDate>",
    );
  });

  it("is where /rss.xml sends readers, for good", async (urls) => {
    const response = await fetch(`${urls.Site}/rss.xml`, {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/rss");
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    await response.arrayBuffer();
  });
});

describe("feeds without data", () => {
  it("answer 503, which crawlers retry, and are never stored", async (urls) => {
    for (const path of ["/sitemap.xml", "/rss"]) {
      const { response, body } = await get(`${urls.Unreachable}${path}`);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
      expect(body).toBe("Temporarily unavailable");
    }
  });
});

describe("page metadata", () => {
  for (const path of sitePages) {
    it(`names ${path}'s production address on a preview, only in links and meta tags`, async (urls) => {
      const { body } = await get(`${urls.Site}${path}`);
      const canonical = `${origin}${path}`;
      expect(body).toContain(`<link rel="canonical" href="${canonical}"/>`);
      expect(body).toContain(
        `<meta property="og:url" content="${canonical}"/>`,
      );
      const head = /<head>(.*)<\/head>/.exec(body)?.[1] ?? "";
      const tags = head.match(/<(?:meta|link) [^>]*https?:[^>]*>/g) ?? [];
      // The canonical URL and og:url; the feed is linked root-relative.
      expect(tags.length).toBeGreaterThanOrEqual(2);
      for (const tag of tags) {
        expect(tag).toMatch(
          /^<(?:meta (?:name|property)="[^"]+" content="https:\/\/allthings\.dev[/"]|link rel="(?:canonical|alternate)")/,
        );
      }
    });
  }
});
