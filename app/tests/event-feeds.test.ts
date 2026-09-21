import { describe, expect, test } from "bun:test";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { generateRSS, generateSiteMap } from "../src/lib/event-feeds";

const event = {
  name: "Show & Tell <Web> 🚀",
  tagline: 'Meet "developers" & share ideas </description><item>fake</item>',
  slug: "2026-show-and-tell",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-16T02:00:00Z"),
};

describe("public event feeds", () => {
  test("RSS parses special characters as text, never injected feed elements", () => {
    const xml = generateRSS([event]);
    expect(XMLValidator.validate(xml)).toBe(true);
    const channel = new XMLParser().parse(xml).rss.channel;
    expect(channel.item.title).toBe(event.name);
    expect(channel.item.description).toBe(event.tagline);
    expect(channel.item.link).toBe(
      "https://allthingsweb.dev/2026-show-and-tell",
    );
    expect(channel.link).toBe("https://allthingsweb.dev");
    expect(channel.item.pubDate).toBe(event.createdAt.toUTCString());
    expect(Array.isArray(channel.item)).toBe(false);
  });

  test("RSS omits invalid XML characters while preserving Unicode and newlines", () => {
    const xml = generateRSS([
      { ...event, name: "Hello\u0000\uD800 🚀\nWorld" },
    ]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(new XMLParser().parse(xml).rss.channel.item.title).toBe(
      "Hello 🚀\nWorld",
    );
  });

  test("sitemap uses the protocol namespace and public URLs with stable modification dates", () => {
    const xml = generateSiteMap([event, { ...event, slug: "a & b#c" }]);
    expect(XMLValidator.validate(xml)).toBe(true);
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml).urlset;
    expect(parsed["@_xmlns"]).toBe(
      "http://www.sitemaps.org/schemas/sitemap/0.9",
    );
    expect(parsed.url.map((url: { loc: string }) => url.loc)).toEqual([
      "https://allthingsweb.dev/",
      "https://allthingsweb.dev/speakers",
      "https://allthingsweb.dev/about",
      "https://allthingsweb.dev/code-of-conduct",
      "https://allthingsweb.dev/2026-show-and-tell",
      "https://allthingsweb.dev/a%20%26%20b%23c",
    ]);
    expect(parsed.url[4].lastmod).toBe(event.updatedAt.toISOString());
    expect(parsed.url[0].lastmod).toBeUndefined();
  });

  test("empty event feeds remain valid documents", () => {
    expect(XMLValidator.validate(generateRSS([]))).toBe(true);
    expect(XMLValidator.validate(generateSiteMap([]))).toBe(true);
  });
});
