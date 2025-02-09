import type { Event } from "~/modules/allthingsweb/events";
import { lru } from "~/modules/cache";
import cachified from "@epic-web/cachified";
import { Route } from "./+types/sitemap[.xml]";

function getUrlElementWithDate(url: string, date: string) {
  return `<url>
        <loc>${url}</loc>
        <lastmod>${date}</lastmod>
        </url>`;
}

function generateSiteMap(events: Event[], origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
            ${getUrlElementWithDate(`${origin}/`, new Date().toISOString())}
            ${getUrlElementWithDate(`${origin}/speakers`, new Date().toISOString())}
            ${getUrlElementWithDate(`${origin}/about`, new Date().toISOString())}
            ${events
              .map(
                (event) =>
                  `${getUrlElementWithDate(`${origin}/${event.slug}`, event.updatedAt.toISOString())}`,
              )
              .join("\n")}
        </urlset>`;
}

export async function loader({ context }: Route.LoaderArgs) {
  const events = await context.queryClient.getPublishedEvents();
  const content = await cachified({
    key: "sitemap",
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateSiteMap(events, context.mainConfig.origin),
  });
  return new Response(content, {
    headers: {
      "content-type": "application/xml",
    },
  });
}
