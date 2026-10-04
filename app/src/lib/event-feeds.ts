import type { Event } from "./events";

type FeedEvent = Pick<
  Event,
  "id" | "name" | "tagline" | "slug" | "startDate" | "createdAt" | "updatedAt"
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

function eventUrl(origin: string, slug: string): string {
  return `${origin}/${encodeURIComponent(slug)}`;
}

/**
 * When an event was announced. Events imported after they happened would
 * otherwise all appear as new on the day they were imported.
 */
function announcedAt(event: FeedEvent): Date {
  return event.createdAt < event.startDate ? event.createdAt : event.startDate;
}

export function generateRSS(events: FeedEvent[], origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
    <channel>
        <title>All Things Web Bay Area events</title>
        <description>Sup! Subscribe to stay up to date with our monthly events.</description>
        <link>${escapeXml(origin)}</link>
        <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
        ${events
          .map(
            (event) => `<item>
            <title>${escapeXml(event.name)}</title>
            <description>${escapeXml(event.tagline)}</description>
            <link>${escapeXml(eventUrl(origin, event.slug))}</link>
            <guid isPermaLink="false">urn:uuid:${event.id}</guid>
            <pubDate>${announcedAt(event).toUTCString()}</pubDate>
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

export function generateSiteMap(events: FeedEvent[], origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            ${getUrlElement(`${origin}/`)}
            ${getUrlElement(`${origin}/speakers`)}
            ${getUrlElement(`${origin}/about`)}
            ${getUrlElement(`${origin}/code-of-conduct`)}
            ${events
              .map((event) =>
                getUrlElement(
                  eventUrl(origin, event.slug),
                  event.updatedAt.toISOString(),
                ),
              )
              .join("\n")}
        </urlset>`;
}
