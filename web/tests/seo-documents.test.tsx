import { describe, expect, test } from "bun:test";
import { roleColor, tokens } from "allthings-brand/src/tokens.ts";
import type { EventPage, Speaker } from "allthings-core/src/event-page.ts";
import { DateTime } from "effect";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { socials } from "../src/links.ts";
import { brandPage } from "../src/pages/brand.tsx";
import { Document } from "../src/pages/document.tsx";
import { eventsPage } from "../src/pages/events.tsx";
import { homePage } from "../src/pages/home.tsx";
import { lockup } from "../src/pages/metadata.tsx";
import {
  eventStructuredData,
  organization,
  serializeJsonLd,
} from "../src/pages/structured-data.ts";
import type { FeedEvent } from "../src/seo/data.ts";
import { isProductionHost, robotsTxt } from "../src/seo/robots.ts";
import { rssXml } from "../src/seo/rss.ts";
import { sitemapXml, sitePages } from "../src/seo/sitemap.ts";
import { escapeXml } from "../src/seo/xml.ts";
import { ogCards } from "../src/og/cards.ts";
import { htmlProblems } from "./support/pages.ts";

/**
 * robots.txt, the sitemap, the RSS feed and the pages' structured data, as
 * pure functions of fixed data. The feeds are also held to the app's own
 * (app/src/lib/event-feeds.ts) wherever subscribers would notice a change.
 */

const origin = "https://allthings.dev";
const at = (iso: string) => DateTime.makeUnsafe(iso);
const char = (code: number) => String.fromCodePoint(code);

/** What the app's feeds read of an event. */
interface AppFeedEvent {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly slug: string;
  readonly startDate: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Loaded at runtime, as tests/support/app.ts loads the app: the app's own
// compiler checks it.
const app = (await import(
  new URL("../../app/src/lib/event-feeds.ts", import.meta.url).href
)) as {
  readonly generateRSS: (events: Array<AppFeedEvent>, origin: string) => string;
  readonly generateSiteMap: (
    events: Array<AppFeedEvent>,
    origin: string,
  ) => string;
};

const toApp = (event: FeedEvent): AppFeedEvent => ({
  ...event,
  startDate: DateTime.toDateUtc(event.startDate),
  createdAt: DateTime.toDateUtc(event.createdAt),
  updatedAt: DateTime.toDateUtc(event.updatedAt),
});

/** Parses the way feed readers do: text stays text, items stay a list. */
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => name === "item" || name === "url",
});

interface Item {
  readonly title: string;
  readonly description: string;
  readonly link: string;
  readonly guid: { readonly "#text": string; readonly "@_isPermaLink": string };
  readonly pubDate: string;
}

interface Channel {
  readonly title: string;
  readonly link: string;
  readonly description: string;
  readonly lastBuildDate?: string;
  readonly "atom:link": Readonly<Record<string, string>>;
  readonly item?: ReadonlyArray<Item>;
}

const channelOf = (xml: string): Channel =>
  (parser.parse(xml) as { rss: { channel: Channel } }).rss.channel;

interface UrlEntry {
  readonly loc: string;
  readonly lastmod?: string;
}

const urlsOf = (xml: string): ReadonlyArray<UrlEntry> =>
  (parser.parse(xml) as { urlset: { url?: ReadonlyArray<UrlEntry> } }).urlset
    .url ?? [];

/** A name meant to break out of every element it lands in. */
const hostile = `</title><item><title>pwned</title></item>]]><!-- & "quotes" 'n' <b>`;

const events: ReadonlyArray<FeedEvent> = [
  {
    id: "e0000000-0000-4000-8000-000000000101",
    slug: "2026-11-05-all-things-effect",
    name: `Effect ${char(0x1f1fa)}${char(0x1f1f8)} & friends`,
    tagline: hostile,
    startDate: at("2026-11-06T01:30:00Z"),
    createdAt: at("2026-09-30T12:00:00Z"),
    updatedAt: at("2026-10-02T08:00:00Z"),
  },
  {
    // Imported long after it happened.
    id: "e0000000-0000-4000-8000-000000000102",
    slug: "a slug & a #fragment?",
    name: hostile,
    tagline: `Tabs\tand\nnewlines stay; NUL${char(0)}, ESC${char(0x1b)}, a lone ${char(0xd800)} and ${char(0xfffe)} go`,
    startDate: at("2025-06-02T00:00:00Z"),
    createdAt: at("2026-09-01T00:00:00Z"),
    updatedAt: at("2026-10-03T09:30:00Z"),
  },
];

describe("XML text", () => {
  test("escapes the five markup characters", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
  });

  test("drops what XML 1.0 forbids and keeps every other character", () => {
    const kept = `tab\t newline\n return\r ${char(0x20)}${char(0xd7ff)}${char(0xe000)}${char(0xfffd)} astral ${char(0x1f680)} ${char(0x10ffff)}`;
    expect(escapeXml(kept)).toBe(kept);
    for (const code of [
      0x0, 0x8, 0xb, 0xc, 0x1f, 0xd800, 0xdfff, 0xfffe, 0xffff,
    ]) {
      expect(escapeXml(`a${char(code)}b`)).toBe("ab");
    }
  });

  test("escapes an existing entity again, so it reads back as written", () => {
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });
});

describe("robots.txt", () => {
  test("lets everything be crawled on the production host and names its sitemap", () => {
    expect(robotsTxt(`${origin}/robots.txt`, origin)).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://allthings.dev/sitemap.xml\n",
    );
  });

  test("keeps crawlers out of every other host", () => {
    for (const url of [
      "https://allthings-web-pr-93.allthings.workers.dev/robots.txt",
      "https://www.allthings.dev/robots.txt",
      "https://next.allthings.dev/robots.txt",
      "https://allthings.dev.example.com/robots.txt",
      "https://allthingsweb.dev/robots.txt",
      "http://localhost:1337/robots.txt",
      "not a url",
    ]) {
      expect(robotsTxt(url, origin)).toBe("User-agent: *\nDisallow: /\n");
    }
  });

  test("compares hosts, not schemes, ports or letter case", () => {
    for (const url of [
      "http://allthings.dev/robots.txt",
      "https://allthings.dev:443/robots.txt",
      "https://ALLTHINGS.dev/robots.txt",
    ]) {
      expect(isProductionHost(url, origin)).toBe(true);
    }
    expect(isProductionHost("http://localhost:8787/", "http://localhost")).toBe(
      true,
    );
  });
});

describe("the sitemap", () => {
  const xml = sitemapXml(events, origin);

  test("is well-formed, in the sitemap protocol's namespace", () => {
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toStartWith(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n',
    );
  });

  test("lists the site's pages, then each event as given, with when it last changed", () => {
    expect(urlsOf(xml)).toEqual([
      { loc: "https://allthings.dev/" },
      { loc: "https://allthings.dev/events" },
      { loc: "https://allthings.dev/people" },
      { loc: "https://allthings.dev/about" },
      { loc: "https://allthings.dev/code-of-conduct" },
      { loc: "https://allthings.dev/brand" },
      {
        loc: "https://allthings.dev/2026-11-05-all-things-effect",
        lastmod: "2026-10-02T08:00:00.000Z",
      },
      {
        loc: "https://allthings.dev/a%20slug%20%26%20a%20%23fragment%3F",
        lastmod: "2026-10-03T09:30:00.000Z",
      },
    ]);
  });

  test("names each event at the URL, and with the date, the app's sitemap does", () => {
    const pairs = (urls: ReadonlyArray<UrlEntry>) =>
      urls.map(({ loc, lastmod }) => [loc, lastmod]);
    const appUrls = urlsOf(app.generateSiteMap(events.map(toApp), origin));
    // The app's own pages differ: these are this site's.
    expect(pairs(urlsOf(xml).slice(sitePages.length))).toEqual(
      pairs(appUrls.slice(-events.length)),
    );
  });

  test("is the same bytes for the same events, and valid with none", () => {
    expect(sitemapXml(events, origin)).toBe(xml);
    const empty = sitemapXml([], origin);
    expect(XMLValidator.validate(empty)).toBe(true);
    expect(urlsOf(empty).map((url) => url.loc)).toEqual([
      "https://allthings.dev/",
      "https://allthings.dev/events",
      "https://allthings.dev/people",
      "https://allthings.dev/about",
      "https://allthings.dev/code-of-conduct",
      "https://allthings.dev/brand",
    ]);
  });
});

describe("the RSS feed", () => {
  const xml = rssXml(events, origin);

  test("is well-formed RSS 2.0 that names its own address", () => {
    expect(XMLValidator.validate(xml)).toBe(true);
    const channel = channelOf(xml);
    expect(channel.title).toBe("all things/_");
    expect(channel.link).toBe("https://allthings.dev/");
    expect(channel["atom:link"]).toEqual({
      "@_href": "https://allthings.dev/rss",
      "@_rel": "self",
      "@_type": "application/rss+xml",
    });
  });

  test("carries hostile names and taglines as text, never as elements", () => {
    const items = channelOf(xml).item ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.description).toBe(hostile);
    expect(items[1]?.title).toBe(hostile);
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).not.toContain("<title>pwned");
  });

  test("drops what XML forbids and keeps emoji, tabs and newlines", () => {
    const items = channelOf(xml).item ?? [];
    expect(items[0]?.title).toBe(events[0]?.name);
    expect(items[1]?.description).toBe(
      "Tabs\tand\nnewlines stay; NUL, ESC, a lone  and  go",
    );
  });

  test("keeps each item's guid, link and date exactly as the app's feed has them", () => {
    const ours = channelOf(xml).item ?? [];
    const theirs = channelOf(app.generateRSS(events.map(toApp), origin)).item;
    const fields = (item: Item) => ({
      title: item.title,
      description: item.description,
      link: item.link,
      guid: item.guid,
      pubDate: item.pubDate,
    });
    expect(ours.map(fields)).toEqual((theirs ?? []).map(fields));
    expect(ours.map((item) => item.guid)).toEqual([
      {
        "#text": "urn:uuid:e0000000-0000-4000-8000-000000000101",
        "@_isPermaLink": "false",
      },
      {
        "#text": "urn:uuid:e0000000-0000-4000-8000-000000000102",
        "@_isPermaLink": "false",
      },
    ]);
    // Announced when created, or when it happened if it was imported later.
    expect(ours.map((item) => item.pubDate)).toEqual([
      "Wed, 30 Sep 2026 12:00:00 GMT",
      "Mon, 02 Jun 2025 00:00:00 GMT",
    ]);
  });

  test("was last built when any event last changed, so the same events make the same bytes", () => {
    expect(channelOf(xml).lastBuildDate).toBe("Sat, 03 Oct 2026 09:30:00 GMT");
    expect(rssXml(events, origin)).toBe(xml);
    expect(rssXml(events.toReversed(), origin)).toContain(
      "<lastBuildDate>Sat, 03 Oct 2026 09:30:00 GMT</lastBuildDate>",
    );
  });

  test("is valid with no events, and has no build date then", () => {
    const empty = rssXml([], origin);
    expect(XMLValidator.validate(empty)).toBe(true);
    const channel = channelOf(empty);
    expect(channel.item).toBeUndefined();
    expect(channel.lastBuildDate).toBeUndefined();
  });
});

/** A published event as its page shows it. */
const details = (overrides: Partial<EventPage> = {}): EventPage => ({
  id: "e0000000-0000-4000-8000-000000000101",
  slug: "2026-11-05-all-things-effect",
  name: "All Things Effect",
  topic: "effect",
  tagline: "Effect, in person.",
  about: null,
  status: "upcoming",
  mode: "night",
  startsAt: at("2026-11-06T01:30:00Z"),
  endsAt: at("2026-11-06T04:30:00Z"),
  updatedAt: at("2026-10-01T00:00:00Z"),
  venue: {
    neighborhood: "East Cut",
    name: "CodeRabbit",
    address: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
    mapQuery: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
  },
  hosts: [],
  hostSites: {},
  organizers: [],
  coHosts: [],
  mcs: [],
  guests: null,
  rsvpUrl: "https://lu.ma/event/evt-abc123",
  seats: null,
  program: "talks",
  curation: { kind: "ours" },
  recordingUrl: null,
  talks: [],
  schedule: [],
  notes: [],
  photos: [],
  posts: [],
  morePosts: 0,
  next: undefined,
  ...overrides,
});

const speaker = (id: string, name: string, title: string | null): Speaker => ({
  id,
  slug: id,
  name,
  title,
  bio: null,
  links: { x: null, bluesky: null, linkedin: null },
  portrait: null,
  role: "speaker",
});

describe("structured data", () => {
  test("describes an event's page as a schema.org Event", () => {
    const michael = speaker("b1", "Michael Arnaldi", "Founder, Effectful");
    const event = details({
      talks: [
        {
          id: "t1",
          title: "Effect 4",
          format: "talk",
          description: null,
          speakers: [michael, speaker("b2", "Kit", null)],
        },
        {
          id: "t2",
          title: "Fireside",
          format: "fireside",
          description: null,
          speakers: [{ ...michael, role: "guest" }],
        },
      ],
    });
    expect(eventStructuredData(event, origin)).toEqual({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "All Things Effect",
      description: "Effect, in person.",
      url: "https://allthings.dev/2026-11-05-all-things-effect",
      startDate: "2026-11-06T01:30:00.000Z",
      endDate: "2026-11-06T04:30:00.000Z",
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      isAccessibleForFree: true,
      organizer: {
        "@type": "Organization",
        name: "all things",
        url: "https://allthings.dev",
      },
      location: {
        "@type": "Place",
        name: "CodeRabbit",
        address: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
      },
      performer: [
        {
          "@type": "Person",
          name: "Michael Arnaldi",
          jobTitle: "Founder, Effectful",
        },
        { "@type": "Person", name: "Kit" },
      ],
      offers: {
        "@type": "Offer",
        url: "https://lu.ma/event/evt-abc123",
        price: 0,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    });
  });

  test("leaves out what an event doesn't have, and names the address when there is no venue", () => {
    const bare = eventStructuredData(
      details({ venue: null, rsvpUrl: null }),
      origin,
    );
    expect(bare).not.toHaveProperty("location");
    expect(bare).not.toHaveProperty("performer");
    expect(bare).not.toHaveProperty("offers");
    expect(bare).not.toHaveProperty("image");
    expect(
      eventStructuredData(
        details({
          venue: {
            neighborhood: null,
            name: null,
            address: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
            mapQuery: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
          },
        }),
        origin,
      ).location,
    ).toEqual({
      "@type": "Place",
      name: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
      address: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
    });
  });

  test("describes the organization behind the site, with its profiles elsewhere", () => {
    expect(organization(origin, "Evenings.")).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "all things",
      url: "https://allthings.dev",
      description: "Evenings.",
      sameAs: socials.map((social) => social.href),
    });
  });

  test("serializes so no value can end its script element, and reads back unchanged", () => {
    const tricky = `</script><script>alert(1)</script><!-- ${char(0x2028)}${char(0x2029)} & é`;
    const data = eventStructuredData(details({ name: tricky }), origin);
    const json = serializeJsonLd(data);
    expect(json).not.toContain("<");
    expect(json).not.toContain(char(0x2028));
    expect(json).not.toContain(char(0x2029));
    expect(JSON.parse(json)).toEqual(data);
  });
});

describe("page metadata", () => {
  const home = homePage({
    home: { next: undefined, afterThat: [], recently: [], photos: [] },
    origin,
    theme: undefined,
    portraits: new Map(),
    images: "variants",
  });
  const brand = brandPage({
    origin,
    theme: undefined,
    portraits: new Map(),
    images: "variants",
  });
  const index = eventsPage({
    evenings: { ahead: [], past: [] },
    origin,
    theme: undefined,
    portraits: new Map(),
    images: "variants",
  });

  /** The head's tags, in order. */
  const head = (html: string) =>
    /<head>(.*)<\/head>/.exec(html)?.[1]?.match(/<[^>]+>/g) ?? [];

  test("says the same things about every page, from one description", () => {
    for (const [html, title, path, description, card] of [
      [
        home,
        "all things/_",
        "/",
        "Evenings for people who build software. In the neighborhoods of San Francisco.",
        ogCards.home,
      ],
      [
        index,
        "every evening · all things/_",
        "/events",
        "Every all things evening, ahead and past. In the neighborhoods of San Francisco.",
        ogCards.events,
      ],
      [
        brand,
        "all things/brand",
        "/brand",
        "The all things/_ brand: palette, type, marks and the rules they follow.",
        ogCards.brand,
      ],
    ] as const) {
      const canonical = `${origin}${path}`;
      expect(html).toContain(`<title>${title}</title>`);
      expect(head(html)).toEqual(
        expect.arrayContaining([
          `<meta name="description" content="${description}"/>`,
          `<link rel="canonical" href="${canonical}"/>`,
          '<link rel="alternate" type="application/rss+xml" href="/rss" title="all things/_"/>',
          '<meta property="og:type" content="website"/>',
          '<meta property="og:site_name" content="all things"/>',
          '<meta property="og:locale" content="en_US"/>',
          `<meta property="og:title" content="${title}"/>`,
          `<meta property="og:description" content="${description}"/>`,
          `<meta property="og:url" content="${canonical}"/>`,
          `<meta property="og:image" content="${origin}${card.src}"/>`,
          '<meta property="og:image:type" content="image/png"/>',
          '<meta property="og:image:width" content="1200"/>',
          '<meta property="og:image:height" content="630"/>',
          `<meta property="og:image:alt" content="${card.alt}"/>`,
          '<meta name="twitter:card" content="summary_large_image"/>',
          '<meta name="twitter:site" content="@allthingswebdev"/>',
          `<meta name="twitter:image" content="${origin}${card.src}"/>`,
          `<meta name="twitter:image:alt" content="${card.alt}"/>`,
          `<meta name="theme-color" content="${roleColor(tokens, "paper", "ground").hex}" media="(prefers-color-scheme: light)"/>`,
          `<meta name="theme-color" content="${roleColor(tokens, "night", "ground").hex}" media="(prefers-color-scheme: dark)"/>`,
        ]),
      );
      // The brand's card, 1200 x 630, for every page that doesn't change with data.
      expect(card.src).toMatch(/^\/assets\/og-[a-z-]+\.[0-9a-f]{16}\.png$/);
      expect([card.width, card.height]).toEqual([1200, 630]);
    }
  });

  test("states the organization on the home page only", () => {
    const blocks = (html: string) =>
      [
        ...html.matchAll(
          /<script type="application\/ld\+json">([^<]*)<\/script>/g,
        ),
      ].map(([, json]) => JSON.parse(json ?? "") as unknown);
    expect(blocks(home)).toEqual([
      organization(
        origin,
        "Evenings for people who build software. In the neighborhoods of San Francisco.",
      ),
    ]);
    expect(blocks(index)).toEqual([]);
    expect(blocks(brand)).toEqual([]);
  });

  test("names only the configured origin in its head", () => {
    for (const html of [home, index, brand]) {
      const urls = [
        ...(/<head>(.*)<\/head>/.exec(html)?.[1] ?? "").matchAll(
          /(?:href|content)="(https?:[^"]*)"/g,
        ),
      ].map(([, url]) => new URL(url ?? "").origin);
      // The canonical URL and og:url; the feed is linked root-relative.
      expect(urls.length).toBeGreaterThanOrEqual(2);
      expect(new Set(urls)).toEqual(new Set([origin]));
    }
  });

  test("escapes what a title or description holds", async () => {
    const html = Document({
      meta: {
        title: lockup("</title><b>x</b>"),
        description: hostile,
        path: "/",
        image: { ...ogCards.home, alt: hostile },
      },
      origin,
      theme: undefined,
      portraits: new Map(),
      images: "variants",
      children: <p>body</p>,
    });
    // Text is escaped; a quoted attribute ends only at its quote.
    expect(html).toContain(
      "<title>all things/&lt;/title&gt;&lt;b&gt;x&lt;/b&gt;</title>",
    );
    expect(html).toContain(
      '<meta name="description" content="</title><item><title>pwned</title></item>]]><!-- & &#34;quotes&#34;',
    );
    expect(await htmlProblems(html)).toEqual([]);
  });
});
