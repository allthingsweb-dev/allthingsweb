import type { Event } from "./events";

const PUBLIC_SITE_ORIGIN = "https://allthingsweb.dev";
type FeedEvent = Pick<
  Event,
  "name" | "tagline" | "slug" | "createdAt" | "updatedAt"
>;

function escapeXml(value: string): string {
  return value
    .replace(
      /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
      "",
    )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function eventUrl(slug: string): string {
  return `${PUBLIC_SITE_ORIGIN}/${encodeURIComponent(slug)}`;
}

export function generateRSS(events: FeedEvent[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
    <channel>
        <title>All Things Web Bay Area events</title>
        <description>Sup! Subscribe to stay up to date with our monthly events.</description>
        <link>${PUBLIC_SITE_ORIGIN}</link>
        <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
        ${events
          .map(
            (event) => `<item>
            <title>${escapeXml(event.name)}</title>
            <description>${escapeXml(event.tagline)}</description>
            <link>${escapeXml(eventUrl(event.slug))}</link>
            <pubDate>${event.createdAt.toUTCString()}</pubDate>
        </item>`,
          )
          .join("\n")}
    </channel>
</rss>`;
}

function getUrlElement(url: string, date?: string) {
  return `<url>
        <loc>${escapeXml(url)}</loc>
        ${date ? `<lastmod>${date}</lastmod>` : ""}
        </url>`;
}

export function generateSiteMap(events: FeedEvent[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            ${getUrlElement(`${PUBLIC_SITE_ORIGIN}/`)}
            ${getUrlElement(`${PUBLIC_SITE_ORIGIN}/speakers`)}
            ${getUrlElement(`${PUBLIC_SITE_ORIGIN}/about`)}
            ${events
              .map((event) =>
                getUrlElement(
                  eventUrl(event.slug),
                  event.updatedAt.toISOString(),
                ),
              )
              .join("\n")}
        </urlset>`;
}
